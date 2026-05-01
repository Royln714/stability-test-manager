const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const cron = require('node-cron');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3001;

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const backupsDir = path.join(__dirname, 'backups');
if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

// ── Cloudinary / file storage ─────────────────────────────────────────────────

const USE_CLOUDINARY = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
if (USE_CLOUDINARY) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log('  Cloudinary image storage enabled');
} else {
  console.log('  Local image storage (set CLOUDINARY_* env vars for persistent image storage)');
}

async function storeFile(file) {
  if (USE_CLOUDINARY) {
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: 'formulabhub', resource_type: 'auto' },
        (err, res) => err ? reject(err) : resolve(res)
      ).end(file.buffer);
    });
    return { public_id: result.public_id, url: result.secure_url, filename: null, original_name: file.originalname };
  }
  const ext = path.extname(file.originalname).toLowerCase();
  const filename = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), file.buffer);
  return { public_id: null, url: `/uploads/${filename}`, filename, original_name: file.originalname };
}

async function destroyFile(public_id, filename) {
  if (public_id) {
    try { await cloudinary.uploader.destroy(public_id); } catch {}
  } else if (filename) {
    const fp = path.join(uploadsDir, filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'stab-mgr-jwt-secret-change-in-prod';
const COOKIE_NAME = 'stab_auth';
const COOKIE_OPTS = { httpOnly: true, sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 };

// ── MongoDB ───────────────────────────────────────────────────────────────────

const mc = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/formulabhub', {
  serverApi: { version: ServerApiVersion.v1, strict: false, deprecationErrors: false },
  serverSelectionTimeoutMS: 15000,
  connectTimeoutMS: 15000,
});
let mdb = null;

function col(name) { return mdb.collection(name); }

async function nextId(collName) {
  const r = await col('counters').findOneAndUpdate(
    { _id: collName },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return r.seq;
}

// Strip MongoDB _id and expose as id
function out(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

// ── Email ─────────────────────────────────────────────────────────────────────

const mailer = (process.env.SMTP_USER && process.env.SMTP_PASS)
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

function now() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function today() { return new Date().toISOString().split('T')[0]; }

const TIME_ORDER = ['Initial', '2_weeks', '1_month', '2_months', '3_months'];
const TP_DAYS = { Initial: 0, '2_weeks': 14, '1_month': 30, '2_months': 60, '3_months': 90 };
const TP_LABELS = { Initial: 'Initial', '2_weeks': '2 Weeks', '1_month': '1 Month', '2_months': '2 Months', '3_months': '3 Months' };
const tpSort = tp => { const i = TIME_ORDER.indexOf(tp); return i === -1 ? 99 : i; };

// ── Cron: daily email reminders ──────────────────────────────────────────────

cron.schedule('0 8 * * *', async () => {
  if (!mailer || !mdb) return;
  try {
    const appUrl = process.env.APP_URL || 'http://localhost:3001';
    const todayMs = new Date().setHours(0, 0, 0, 0);
    const samples = await col('samples').find({ $or: [{ status: 'active' }, { status: { $exists: false } }] }).toArray();
    const alerts = [];
    for (const s of samples) {
      if (!s.date_started) continue;
      const start = new Date(s.date_started);
      const done = new Set((await col('results').find({ sample_id: s._id }, { projection: { time_point: 1 } }).toArray()).map(r => r.time_point));
      TIME_ORDER.forEach(tp => {
        if (done.has(tp)) return;
        const dueMs = new Date(start).setDate(start.getDate() + TP_DAYS[tp]);
        const diff = Math.ceil((dueMs - todayMs) / 86400000);
        if (diff < 0 || (diff >= 0 && diff <= 3)) alerts.push({ sample: s, tp, diff });
      });
    }
    if (!alerts.length) return;
    const recipients = (await col('users').find({ is_active: true, email: { $ne: '' } }).toArray()).map(u => u.email).filter(Boolean);
    if (!recipients.length) return;
    const rows = alerts.map(a => {
      const label = a.diff < 0
        ? `<span style="color:#dc2626">OVERDUE (${Math.abs(a.diff)}d ago)</span>`
        : `Due in ${a.diff} day(s)`;
      return `<tr><td style="padding:6px 12px;border-bottom:1px solid #f0f0f0">${a.sample.name}</td><td style="padding:6px 12px;border-bottom:1px solid #f0f0f0">${TP_LABELS[a.tp]}</td><td style="padding:6px 12px;border-bottom:1px solid #f0f0f0">${label}</td></tr>`;
    }).join('');
    await mailer.sendMail({
      from: `"FormuLab Hub" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: recipients.join(','),
      subject: `FormuLab Hub — ${alerts.length} time point(s) need attention`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
<div style="background:#1e40af;padding:16px 20px;border-radius:10px 10px 0 0"><h2 style="color:#fff;margin:0;font-size:16px">🧪 FormuLab Hub — Stability Reminders</h2></div>
<div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 10px 10px">
<p style="color:#374151;margin-top:0">The following time points require attention:</p>
<table style="width:100%;border-collapse:collapse;font-size:13px">
<thead><tr style="background:#f9fafb"><th style="padding:8px 12px;text-align:left;color:#6b7280">Sample</th><th style="padding:8px 12px;text-align:left;color:#6b7280">Time Point</th><th style="padding:8px 12px;text-align:left;color:#6b7280">Status</th></tr></thead>
<tbody>${rows}</tbody></table>
<div style="margin-top:20px"><a href="${appUrl}" style="background:#1e40af;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px">Open FormuLab Hub</a></div>
</div></body></html>`,
    });
    console.log(`[cron] Sent reminder for ${alerts.length} alerts`);
  } catch (err) {
    console.error('[cron] Email error:', err.message);
  }
});

// ── Auto-backup helper ────────────────────────────────────────────────────────

async function saveLocalBackup() {
  if (!mdb) return;
  const [samples, results, images, formulations, users, counters] = await Promise.all([
    col('samples').find().toArray(),
    col('results').find().toArray(),
    col('images').find().toArray(),
    col('formulations').find().toArray(),
    col('users').find().toArray(),
    col('counters').find().toArray(),
  ]);
  const _counters = {};
  counters.forEach(c => { _counters[c._id] = c.seq; });
  const backup = {
    version: 1, app: 'FormuLab Hub', exported_at: new Date().toISOString(),
    samples: samples.map(out), results: results.map(out), images: images.map(out),
    formulations: formulations.map(out), users: users.map(out), _counters,
  };
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `formulab-backup-${timestamp}.zip`;
  const filepath = path.join(backupsDir, filename);
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filepath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(JSON.stringify(backup, null, 2), { name: 'backup.json' });
    if (fs.existsSync(uploadsDir)) archive.directory(uploadsDir, 'uploads');
    archive.finalize();
  });

  // Keep only the 7 most recent backups
  const files = fs.readdirSync(backupsDir)
    .filter(f => f.startsWith('formulab-backup-') && f.endsWith('.zip'))
    .sort();
  files.slice(0, Math.max(0, files.length - 7))
    .forEach(f => fs.unlinkSync(path.join(backupsDir, f)));

  console.log(`[backup] Saved ${filename} (${(fs.statSync(filepath).size / 1024).toFixed(1)} KB)`);
}

// ── Cron: daily auto-backup at 02:00 ─────────────────────────────────────────

cron.schedule('0 2 * * *', async () => {
  try {
    await saveLocalBackup();
  } catch (err) {
    console.error('[backup] Auto-backup failed:', err.message);
  }
});

// ── Auth helpers ──────────────────────────────────────────────────────────────

const loginAttempts = new Map();
function checkRateLimit(ip) {
  const n = Date.now();
  const list = (loginAttempts.get(ip) || []).filter(t => n - t < 15 * 60 * 1000);
  if (list.length >= 10) return false;
  list.push(n); loginAttempts.set(ip, list);
  return true;
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.clearCookie(COOKIE_NAME); return res.status(401).json({ error: 'Session expired' }); }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

async function logAudit(userId, username, action, ip, details) {
  try {
    const id = await nextId('audit_log');
    await col('audit_log').insertOne({ _id: id, user_id: userId, username, action, ip: ip || '', details: details || '', created_at: now() });
  } catch {}
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(uploadsDir));

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  requireAuth(req, res, next);
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.(jpe?g|png|gif|webp|pdf)$/i.test(file.originalname))
});

const importStorage = multer.diskStorage({
  destination: __dirname,
  filename: (req, file, cb) => cb(null, `backup-import-${Date.now()}${path.extname(file.originalname).toLowerCase()}`)
});
const uploadImport = multer({
  storage: importStorage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.(json|zip)$/i.test(file.originalname))
});

// ── AUTH ──────────────────────────────────────────────────────────────────────

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await col('users').findOne({ _id: req.user.id });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const { password_hash, ...safe } = out(user);
    res.json(safe);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || '';
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const user = await col('users').findOne({ username: username.trim() });
    if (!user || !user.is_active) {
      await logAudit(0, username, 'login_fail', ip, 'User not found or inactive');
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      await logAudit(user._id, username, 'login_fail', ip, 'Wrong password');
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    await col('users').updateOne({ _id: user._id }, { $set: { last_login: now() } });
    await logAudit(user._id, user.username, 'login', ip, '');
    const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    const { password_hash, ...safe } = out(user);
    res.json(safe);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await logAudit(req.user.id, req.user.username, 'logout', req.ip || '', '');
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: 'Email address required' });
  try {
    const user = await col('users').findOne({ email: { $regex: new RegExp(`^${email.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, is_active: true });
    if (!user) return res.json({ message: 'If that email is registered, a reset link has been sent.' });
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await col('password_resets').deleteMany({ user_id: user._id });
    await col('password_resets').insertOne({ _id: token, user_id: user._id, expires });
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${appUrl}/reset-password?token=${token}`;
    if (mailer) {
      try {
        await mailer.sendMail({
          from: `"FormuLab Hub" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
          to: user.email,
          subject: 'FormuLab Hub — Password Reset',
          html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f9fafb;">
<div style="background:#1e40af;padding:20px 24px;border-radius:10px 10px 0 0;"><h1 style="color:#fff;margin:0;font-size:18px;">🧪 FormuLab Hub</h1></div>
<div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:28px 24px;border-radius:0 0 10px 10px;">
<h2 style="color:#1f2937;margin-top:0;">Password Reset Request</h2>
<p style="color:#6b7280;">Hello <strong>${user.username}</strong>,</p>
<p style="color:#6b7280;">Click the button below to reset your password. This link expires in <strong>1 hour</strong>.</p>
<div style="text-align:center;margin:32px 0;"><a href="${resetUrl}" style="background:#1e40af;color:#fff;padding:13px 36px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">Reset My Password</a></div>
<p style="color:#9ca3af;font-size:12px;">If you didn't request this, ignore this email.</p>
<p style="color:#9ca3af;font-size:12px;word-break:break-all;">Link: ${resetUrl}</p>
</div></body></html>`,
        });
      } catch (err) {
        console.error('Email send error:', err.message);
        console.log(`[RESET LINK - email failed, use this for ${user.username}] ${resetUrl}`);
      }
    } else {
      console.log(`[RESET LINK - no SMTP configured, use this for ${user.username}] ${resetUrl}`);
    }
    res.json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/:id/reset-link', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const user = await col('users').findOne({ _id: id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await col('password_resets').deleteMany({ user_id: id });
    await col('password_resets').insertOne({ _id: token, user_id: id, expires });
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${appUrl}/reset-password?token=${token}`, expires });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) return res.status(400).json({ error: 'Token and new password required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const reset = await col('password_resets').findOne({ _id: token });
    if (!reset) return res.status(400).json({ error: 'Invalid or expired reset link' });
    if (new Date() > new Date(reset.expires)) {
      await col('password_resets').deleteOne({ _id: token });
      return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
    }
    await col('users').updateOne({ _id: reset.user_id }, { $set: { password_hash: bcrypt.hashSync(new_password, 10) } });
    await col('password_resets').deleteOne({ _id: token });
    await logAudit(reset.user_id, '', 'password_reset', req.ip || '', 'Password reset via link');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/auth/password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  try {
    const user = await col('users').findOne({ _id: req.user.id });
    if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await col('users').updateOne({ _id: req.user.id }, { $set: { password_hash: bcrypt.hashSync(new_password, 10) } });
    await logAudit(req.user.id, req.user.username, 'password_changed', req.ip || '', '');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── USER MANAGEMENT ───────────────────────────────────────────────────────────

app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const users = await col('users').find().toArray();
    res.json(users.map(u => { const { password_hash, ...safe } = out(u); return safe; }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: 'Username required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    if (await col('users').findOne({ username: username.trim() })) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    const id = await nextId('users');
    const user = { _id: id, username: username.trim(), email: email || '', password_hash: bcrypt.hashSync(password, 10), role: role === 'admin' ? 'admin' : 'user', is_active: true, created_at: now(), last_login: null };
    await col('users').insertOne(user);
    await logAudit(req.user.id, req.user.username, 'user_created', req.ip || '', `Created user: ${username}`);
    const { password_hash, ...safe } = out(user);
    res.status(201).json(safe);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { username, email, password, role, is_active } = req.body;
  try {
    const user = await col('users').findOne({ _id: id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (username?.trim() && await col('users').findOne({ username: username.trim(), _id: { $ne: id } })) {
      return res.status(400).json({ error: 'Username already taken' });
    }
    const $set = {};
    if (username?.trim()) $set.username = username.trim();
    if (email !== undefined) $set.email = email;
    if (role === 'admin' || role === 'user') $set.role = role;
    if (typeof is_active === 'boolean') $set.is_active = is_active;
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      $set.password_hash = bcrypt.hashSync(password, 10);
    }
    await col('users').updateOne({ _id: id }, { $set });
    await logAudit(req.user.id, req.user.username, 'user_updated', req.ip || '', `Updated user: ${user.username}`);
    const updated = await col('users').findOne({ _id: id });
    const { password_hash, ...safe } = out(updated);
    res.json(safe);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  try {
    const user = await col('users').findOne({ _id: id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    await logAudit(req.user.id, req.user.username, 'user_deleted', req.ip || '', `Deleted user: ${user.username}`);
    await col('users').deleteOne({ _id: id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/audit-log', requireAdmin, async (req, res) => {
  try {
    const logs = await col('audit_log').find().sort({ _id: -1 }).limit(200).toArray();
    res.json(logs.map(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SAMPLES ───────────────────────────────────────────────────────────────────

const DEFAULT_TEMPS = [
  { value: 25, na_tps: [] },
  { value: 45, na_tps: ['Initial'] },
  { value: 50, na_tps: ['Initial'] },
];

function parseTc(tc) {
  if (!tc) return DEFAULT_TEMPS;
  try { return typeof tc === 'string' ? JSON.parse(tc) : tc; } catch { return DEFAULT_TEMPS; }
}

app.get('/api/samples', async (req, res) => {
  const { search } = req.query;
  try {
    const query = search
      ? { $or: [{ name: { $regex: search, $options: 'i' } }, { ref_no: { $regex: search, $options: 'i' } }] }
      : {};
    const samples = await col('samples').find(query).sort({ created_at: -1 }).toArray();
    const result = await Promise.all(samples.map(async s => {
      const [completed_points, doneRows, image_count] = await Promise.all([
        col('results').countDocuments({ sample_id: s._id }),
        col('results').find({ sample_id: s._id }, { projection: { time_point: 1 } }).toArray(),
        col('images').countDocuments({ sample_id: s._id }),
      ]);
      const { _id, temp_config: tc, ...rest } = s;
      return { id: _id, ...rest, temp_config: parseTc(tc), completed_points, time_points_done: doneRows.map(r => r.time_point), image_count };
    }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/samples/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const sample = await col('samples').findOne({ _id: id });
    if (!sample) return res.status(404).json({ error: 'Not found' });
    const [rawResults, rawImages] = await Promise.all([
      col('results').find({ sample_id: id }).toArray(),
      col('images').find({ sample_id: id }).sort({ uploaded_at: 1 }).toArray(),
    ]);
    const results = rawResults.sort((a, b) => tpSort(a.time_point) - tpSort(b.time_point)).map(out);
    const images = rawImages.map(out);
    const { _id, temp_config: tc, ...rest } = sample;
    res.json({ id: _id, ...rest, temp_config: parseTc(tc), results, images });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/samples', async (req, res) => {
  const { name, ref_no, date_started, remarks, temp_config, status, spec_ph_min, spec_ph_max, spec_visc_min, spec_visc_max } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Sample name is required' });
  const toNum = v => (v != null && v !== '') ? Number(v) : null;
  try {
    const id = await nextId('samples');
    const sample = {
      _id: id, name: name.trim(), ref_no: ref_no || '', date_started: date_started || '', remarks: remarks || '',
      temp_config: JSON.stringify(temp_config || DEFAULT_TEMPS),
      status: status || 'active',
      spec_ph_min: toNum(spec_ph_min), spec_ph_max: toNum(spec_ph_max),
      spec_visc_min: toNum(spec_visc_min), spec_visc_max: toNum(spec_visc_max),
      created_at: now(),
    };
    await col('samples').insertOne(sample);
    const { _id, temp_config: tc, ...rest } = sample;
    res.status(201).json({ id: _id, ...rest, temp_config: parseTc(tc) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/samples/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { name, ref_no, date_started, remarks, temp_config, spec_ph_min, spec_ph_max, spec_visc_min, spec_visc_max } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Sample name is required' });
  const toNum = v => (v != null && v !== '') ? Number(v) : null;
  try {
    const cur = await col('samples').findOne({ _id: id });
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const $set = {
      name: name.trim(), ref_no: ref_no || '', date_started: date_started || '', remarks: remarks || '',
      temp_config: JSON.stringify(temp_config || DEFAULT_TEMPS),
      spec_ph_min: spec_ph_min !== undefined ? toNum(spec_ph_min) : cur.spec_ph_min ?? null,
      spec_ph_max: spec_ph_max !== undefined ? toNum(spec_ph_max) : cur.spec_ph_max ?? null,
      spec_visc_min: spec_visc_min !== undefined ? toNum(spec_visc_min) : cur.spec_visc_min ?? null,
      spec_visc_max: spec_visc_max !== undefined ? toNum(spec_visc_max) : cur.spec_visc_max ?? null,
    };
    await col('samples').updateOne({ _id: id }, { $set });
    const updated = await col('samples').findOne({ _id: id });
    const { _id, temp_config: tc, ...rest } = updated;
    res.json({ id: _id, ...rest, temp_config: parseTc(tc) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/samples/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!['active', 'completed', 'failed', 'on_hold'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const sample = await col('samples').findOne({ _id: id });
    if (!sample) return res.status(404).json({ error: 'Not found' });
    await col('samples').updateOne({ _id: id }, { $set: { status } });
    const { _id, temp_config: tc, ...rest } = sample;
    res.json({ id: _id, ...rest, temp_config: parseTc(tc), status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/samples/:id/duplicate', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const src = await col('samples').findOne({ _id: id });
    if (!src) return res.status(404).json({ error: 'Not found' });
    const newId = await nextId('samples');
    const { _id, ...srcRest } = src;
    const copy = { ...srcRest, _id: newId, name: `${src.name} (Copy)`, status: 'active', created_at: now() };
    await col('samples').insertOne(copy);
    const { _id: cid, temp_config: tc, ...crest } = copy;
    res.status(201).json({ id: cid, ...crest, temp_config: parseTc(tc), results: [], images: [], completed_points: 0, image_count: 0, time_points_done: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/samples/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const images = await col('images').find({ sample_id: id }).toArray();
    await Promise.all(images.map(img => destroyFile(img.public_id, img.filename)));
    await Promise.all([
      col('samples').deleteOne({ _id: id }),
      col('results').deleteMany({ sample_id: id }),
      col('images').deleteMany({ sample_id: id }),
    ]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RESULTS ───────────────────────────────────────────────────────────────────

app.post('/api/samples/:id/results', async (req, res) => {
  const sample_id = Number(req.params.id);
  const {
    time_point, ph_25, viscosity_25, ph_45, viscosity_45, ph_50, viscosity_50,
    spindle_25, rpm_25, spindle_45, rpm_45, spindle_50, rpm_50,
    sg_25, sg_45, sg_50, turbidity_25, turbidity_45, turbidity_50, microbial,
    notes, measured_at, appearance, color_obs, odor, phase_sep,
  } = req.body;
  if (!time_point) return res.status(400).json({ error: 'time_point required' });
  const toNum = v => (v === '' || v === null || v === undefined) ? null : Number(v);
  try {
    const data = {
      sample_id, time_point,
      ph_25: toNum(ph_25), viscosity_25: toNum(viscosity_25), spindle_25: spindle_25 || null, rpm_25: toNum(rpm_25),
      ph_45: toNum(ph_45), viscosity_45: toNum(viscosity_45), spindle_45: spindle_45 || null, rpm_45: toNum(rpm_45),
      ph_50: toNum(ph_50), viscosity_50: toNum(viscosity_50), spindle_50: spindle_50 || null, rpm_50: toNum(rpm_50),
      sg_25: toNum(sg_25), sg_45: toNum(sg_45), sg_50: toNum(sg_50),
      turbidity_25: toNum(turbidity_25), turbidity_45: toNum(turbidity_45), turbidity_50: toNum(turbidity_50),
      microbial: microbial || null, notes: notes || '', measured_at: measured_at || today(),
      appearance: appearance || null, color_obs: color_obs || null, odor: odor || null, phase_sep: phase_sep || null,
    };
    const existing = await col('results').findOne({ sample_id, time_point });
    let result;
    if (existing) {
      await col('results').updateOne({ _id: existing._id }, { $set: data });
      result = out({ ...existing, ...data });
    } else {
      const id = await nextId('results');
      const doc = { _id: id, ...data };
      await col('results').insertOne(doc);
      result = out(doc);
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/results/:id', async (req, res) => {
  try {
    await col('results').deleteOne({ _id: Number(req.params.id) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── IMAGES ────────────────────────────────────────────────────────────────────

app.post('/api/samples/:id/images', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const sample_id = Number(req.params.id);
  try {
    const stored = await storeFile(req.file);
    const id = await nextId('images');
    const image = { _id: id, sample_id, ...stored, caption: req.body.caption || '', category: req.body.category || 'general', time_point: req.body.time_point || null, uploaded_at: now() };
    await col('images').insertOne(image);
    res.status(201).json(out(image));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/images/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const img = await col('images').findOne({ _id: id });
    if (!img) return res.status(404).json({ error: 'Not found' });
    await col('images').updateOne({ _id: id }, { $set: { caption: req.body.caption || '' } });
    res.json(out({ ...img, caption: req.body.caption || '' }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/images/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const img = await col('images').findOne({ _id: id });
    if (img) {
      await destroyFile(img.public_id, img.filename);
      await col('images').deleteOne({ _id: id });
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FORMULATIONS ─────────────────────────────────────────────────────────────

const DEFAULT_DISCLAIMER = 'This information is provided based on our technical data and present knowledge. However, we make no warranties, expressed or implied, and assume no liabilities in connection with any use of the information with respect to specific property, safety and suitability for a specific application. The suitability and safety of the final formulation should be confirmed in all respects by appropriate evaluation. It is also not guaranteed that use of the information does not fall within the scope of any intellectual property rights.';

app.get('/api/formulations', async (req, res) => {
  try {
    const fmts = await col('formulations').find().sort({ created_at: -1 }).toArray();
    res.json(fmts.map(out));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/formulations/:id', async (req, res) => {
  try {
    const f = await col('formulations').findOne({ _id: Number(req.params.id) });
    if (!f) return res.status(404).json({ error: 'Not found' });
    res.json(out(f));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/formulations', async (req, res) => {
  try {
    const id = await nextId('formulations');
    const f = {
      _id: id,
      product_name: req.body.product_name || '', ref_no: req.body.ref_no || '',
      description: req.body.description || '', bulk_size: req.body.bulk_size || 100,
      ingredients: req.body.ingredients || [], procedure: req.body.procedure || [],
      specifications: req.body.specifications || [],
      company_name: req.body.company_name || 'ET',
      company_address: req.body.company_address || 'No6, Jalan Spring 34/32, Golden Pavilion Industrial Park @Bukit Kemuning\nSeksyen 34, 40470 Shah Alam, Selangor.',
      company_tel: req.body.company_tel || '+603-51318868',
      company_fax: req.body.company_fax || '+603-51314899',
      logo_filename: req.body.logo_filename || '', ref_image_filename: req.body.ref_image_filename || '',
      disclaimer: req.body.disclaimer || DEFAULT_DISCLAIMER,
      remarks: req.body.remarks || '', linked_sample_id: req.body.linked_sample_id || null,
      created_at: now(),
    };
    await col('formulations').insertOne(f);
    res.status(201).json(out(f));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/formulations/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const f = await col('formulations').findOne({ _id: id });
    if (!f) return res.status(404).json({ error: 'Not found' });
    const { id: _rid, _id: _mid, ...body } = req.body;
    const updated = { ...f, ...body, _id: id, created_at: f.created_at };
    await col('formulations').replaceOne({ _id: id }, updated);
    res.json(out(updated));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/formulations/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const f = await col('formulations').findOne({ _id: id });
    if (f) {
      await Promise.all([
        destroyFile(f.logo_public_id, f.logo_filename),
        destroyFile(f.ref_image_public_id, f.ref_image_filename),
      ]);
      await col('formulations').deleteOne({ _id: id });
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/formulations/:id/logo', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const id = Number(req.params.id);
  try {
    const f = await col('formulations').findOne({ _id: id });
    if (!f) return res.status(404).json({ error: 'Not found' });
    await destroyFile(f.logo_public_id, f.logo_filename);
    const stored = await storeFile(req.file);
    await col('formulations').updateOne({ _id: id }, { $set: { logo_url: stored.url, logo_public_id: stored.public_id, logo_filename: stored.original_name } });
    res.json({ url: stored.url, filename: stored.original_name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/formulations/:id/refimage', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const id = Number(req.params.id);
  try {
    const f = await col('formulations').findOne({ _id: id });
    if (!f) return res.status(404).json({ error: 'Not found' });
    await destroyFile(f.ref_image_public_id, f.ref_image_filename);
    const stored = await storeFile(req.file);
    await col('formulations').updateOne({ _id: id }, { $set: { ref_image_url: stored.url, ref_image_public_id: stored.public_id, ref_image_filename: stored.original_name } });
    res.json({ url: stored.url, filename: stored.original_name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── BACKUP / RESTORE ──────────────────────────────────────────────────────────

app.get('/api/backup/export', requireAdmin, async (req, res) => {
  try {
    const [samples, results, images, formulations, users, counters] = await Promise.all([
      col('samples').find().toArray(),
      col('results').find().toArray(),
      col('images').find().toArray(),
      col('formulations').find().toArray(),
      col('users').find().toArray(),
      col('counters').find().toArray(),
    ]);
    const _counters = {};
    counters.forEach(c => { _counters[c._id] = c.seq; });
    const backup = {
      version: 1, app: 'FormuLab Hub', exported_at: new Date().toISOString(),
      samples: samples.map(out), results: results.map(out), images: images.map(out),
      formulations: formulations.map(out), users: users.map(out), _counters,
    };
    const filename = `formulab-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/zip');
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
    archive.pipe(res);
    archive.append(JSON.stringify(backup, null, 2), { name: 'backup.json' });
    if (fs.existsSync(uploadsDir)) archive.directory(uploadsDir, 'uploads');
    archive.finalize();
    // Also save a local copy whenever admin manually exports
    saveLocalBackup().catch(err => console.error('[backup] Local save failed:', err.message));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/backup/import', requireAdmin, uploadImport.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No backup file uploaded' });
  const tempPath = req.file.path;
  try {
    let backup;
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext === '.zip') {
      const zip = new AdmZip(tempPath);
      const entry = zip.getEntry('backup.json');
      if (!entry) return res.status(400).json({ error: 'Invalid backup ZIP: backup.json not found' });
      backup = JSON.parse(entry.getData().toString('utf8'));
      zip.getEntries().forEach(e => {
        if (e.entryName.startsWith('uploads/') && !e.isDirectory) {
          fs.writeFileSync(path.join(uploadsDir, path.basename(e.entryName)), e.getData());
        }
      });
    } else {
      backup = JSON.parse(fs.readFileSync(tempPath, 'utf8'));
    }
    const { version, samples, results, images, formulations, users, _counters } = backup;
    if (!version || !Array.isArray(samples) || !Array.isArray(formulations)) {
      return res.status(400).json({ error: 'Invalid or unrecognised backup file' });
    }
    if (!Array.isArray(users) || !users.some(u => u.role === 'admin' && u.is_active)) {
      return res.status(400).json({ error: 'Backup must contain at least one active admin user' });
    }
    // Normalise: backup uses id, MongoDB uses _id
    const norm = arr => (arr || []).map(({ id, _id, ...rest }) => ({ _id: id ?? _id, ...rest }));
    await Promise.all(['samples', 'results', 'images', 'formulations', 'users', 'counters'].map(c => col(c).deleteMany({})));
    const ns = norm(samples), nr = norm(results), ni = norm(images), nf = norm(formulations), nu = norm(users);
    if (ns.length) await col('samples').insertMany(ns);
    if (nr.length) await col('results').insertMany(nr);
    if (ni.length) await col('images').insertMany(ni);
    if (nf.length) await col('formulations').insertMany(nf);
    if (nu.length) await col('users').insertMany(nu);
    if (_counters) {
      const cDocs = Object.entries(_counters).map(([k, v]) => ({ _id: k, seq: v }));
      if (cDocs.length) await col('counters').insertMany(cDocs);
    }
    await logAudit(req.user.id, req.user.username, 'backup_restored', req.ip || '', 'Data restored from backup');
    res.json({ success: true, stats: { samples: ns.length, formulations: nf.length, users: nu.length } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
});

// ── Production static serve ───────────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client/dist')));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'client/dist/index.html')));
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  const safeUri = (process.env.MONGODB_URI || 'localhost').replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
  console.log(`  Connecting to MongoDB: ${safeUri}`);
  await mc.connect();
  mdb = mc.db('formulabhub');
  console.log('  Connected to MongoDB');

  // Ensure at least one admin user exists
  const adminCount = await col('users').countDocuments({ role: 'admin', is_active: true });
  if (adminCount === 0) {
    const id = await nextId('users');
    await col('users').insertOne({
      _id: id, username: 'admin', email: '', password_hash: bcrypt.hashSync('Admin@123', 10),
      role: 'admin', is_active: true, created_at: now(), last_login: null,
    });
    console.log('  Default admin created — username: admin  password: Admin@123');
    console.log('  Change the password after first login!\n');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  Stability Test App running at:\n  -> http://localhost:${PORT}\n`);
  });
}

start().catch(err => {
  const msg = '\n  STARTUP FAILED: ' + (err?.message || String(err)) + '\n\n';
  process.stderr.write(msg, () => process.exit(1));
});
