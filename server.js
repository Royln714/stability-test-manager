const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3001;

const DATA_DIR = process.env.DATA_DIR || __dirname;
const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const JWT_SECRET = process.env.JWT_SECRET || 'stab-mgr-jwt-secret-change-in-prod';
const COOKIE_NAME = 'stab_auth';
const COOKIE_OPTS = { httpOnly: true, sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 };

// ── JSON file database ────────────────────────────────────────────────────────

const DB_FILE = path.join(DATA_DIR, 'stability_data.json');

function readDB() {
  let data;
  if (!fs.existsSync(DB_FILE)) {
    data = { _counters: {}, samples: [], results: [], images: [], formulations: [], users: [], audit_log: [] };
  } else {
    data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  }
  if (!data.formulations) data.formulations = [];
  if (!data.users) data.users = [];
  if (!data.audit_log) data.audit_log = [];
  if (!data._counters) data._counters = {};
  ['samples','results','images','formulations','users','audit_log'].forEach(t => {
    if (!data._counters[t]) data._counters[t] = 0;
  });
  return data;
}

function writeDB(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmp, DB_FILE);
}

function nextId(db, table) {
  db._counters[table] = (db._counters[table] || 0) + 1;
  return db._counters[table];
}

function now() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function today() { return new Date().toISOString().split('T')[0]; }

const TIME_ORDER = ['Initial', '2_weeks', '1_month', '2_months', '3_months'];
const tpSort = tp => { const i = TIME_ORDER.indexOf(tp); return i === -1 ? 99 : i; };

// ── Auth helpers ──────────────────────────────────────────────────────────────

const loginAttempts = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const list = (loginAttempts.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
  if (list.length >= 10) return false;
  list.push(now);
  loginAttempts.set(ip, list);
  return true;
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie(COOKIE_NAME);
    return res.status(401).json({ error: 'Session expired' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

function logAudit(db, userId, username, action, ip, details) {
  db.audit_log.push({ id: nextId(db, 'audit_log'), user_id: userId, username, action, ip: ip || '', details: details || '', created_at: now() });
  if (db.audit_log.length > 500) db.audit_log = db.audit_log.slice(-500);
}

// ── Ensure default admin on startup ──────────────────────────────────────────

(function ensureAdmin() {
  const db = readDB();
  if (db.users.length === 0) {
    const hash = bcrypt.hashSync('Admin@123', 10);
    db.users.push({
      id: nextId(db, 'users'),
      username: 'admin',
      email: '',
      password_hash: hash,
      role: 'admin',
      is_active: true,
      created_at: now(),
      last_login: null,
    });
    writeDB(db);
    console.log('  Default admin created — username: admin  password: Admin@123');
    console.log('  Change the password after first login!\n');
  }
})();

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(uploadsDir));

// Protect all /api/* routes except /api/auth/*
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  requireAuth(req, res, next);
});

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.(jpe?g|png|gif|webp|pdf)$/i.test(file.originalname))
});

// ── AUTH ──────────────────────────────────────────────────────────────────────

app.get('/api/auth/me', requireAuth, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const { password_hash, ...safe } = user;
  res.json(safe);
});

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || '';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const db = readDB();
  const user = db.users.find(u => u.username === username.trim());
  if (!user || !user.is_active) {
    logAudit(db, 0, username, 'login_fail', ip, 'User not found or inactive');
    writeDB(db);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    logAudit(db, user.id, username, 'login_fail', ip, 'Wrong password');
    writeDB(db);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  user.last_login = now();
  logAudit(db, user.id, user.username, 'login', ip, '');
  writeDB(db);

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  const { password_hash, ...safe } = user;
  res.json(safe);
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const db = readDB();
  logAudit(db, req.user.id, req.user.username, 'logout', req.ip || '', '');
  writeDB(db);
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

app.put('/api/auth/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  user.password_hash = bcrypt.hashSync(new_password, 10);
  logAudit(db, user.id, user.username, 'password_changed', req.ip || '', '');
  writeDB(db);
  res.json({ success: true });
});

// ── USER MANAGEMENT (admin only) ──────────────────────────────────────────────

app.get('/api/users', requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.users.map(u => { const { password_hash, ...safe } = u; return safe; }));
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: 'Username required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const db = readDB();
  if (db.users.find(u => u.username === username.trim())) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  const user = {
    id: nextId(db, 'users'),
    username: username.trim(),
    email: email || '',
    password_hash: bcrypt.hashSync(password, 10),
    role: role === 'admin' ? 'admin' : 'user',
    is_active: true,
    created_at: now(),
    last_login: null,
  };
  db.users.push(user);
  logAudit(db, req.user.id, req.user.username, 'user_created', req.ip || '', `Created user: ${username}`);
  writeDB(db);
  const { password_hash, ...safe } = user;
  res.status(201).json(safe);
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { username, email, password, role, is_active } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.id === id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (username?.trim()) {
    const taken = db.users.find(u => u.username === username.trim() && u.id !== id);
    if (taken) return res.status(400).json({ error: 'Username already taken' });
    user.username = username.trim();
  }
  if (email !== undefined) user.email = email;
  if (role === 'admin' || role === 'user') user.role = role;
  if (typeof is_active === 'boolean') user.is_active = is_active;
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    user.password_hash = bcrypt.hashSync(password, 10);
  }
  logAudit(db, req.user.id, req.user.username, 'user_updated', req.ip || '', `Updated user: ${user.username}`);
  writeDB(db);
  const { password_hash, ...safe } = user;
  res.json(safe);
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  const db = readDB();
  const user = db.users.find(u => u.id === id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  logAudit(db, req.user.id, req.user.username, 'user_deleted', req.ip || '', `Deleted user: ${user.username}`);
  db.users = db.users.filter(u => u.id !== id);
  writeDB(db);
  res.json({ success: true });
});

app.get('/api/audit-log', requireAdmin, (req, res) => {
  const db = readDB();
  res.json([...db.audit_log].reverse().slice(0, 200));
});

// ── SAMPLES ───────────────────────────────────────────────────────────────────

app.get('/api/samples', (req, res) => {
  const { search } = req.query;
  const db = readDB();
  let samples = db.samples;
  if (search) {
    const q = search.toLowerCase();
    samples = samples.filter(s => s.name.toLowerCase().includes(q) || (s.ref_no || '').toLowerCase().includes(q));
  }
  const result = samples
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(s => ({
      ...s,
      completed_points: db.results.filter(r => r.sample_id === s.id).length,
      time_points_done: db.results.filter(r => r.sample_id === s.id).map(r => r.time_point),
      image_count: db.images.filter(i => i.sample_id === s.id).length,
    }));
  res.json(result);
});

app.get('/api/samples/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = readDB();
  const sample = db.samples.find(s => s.id === id);
  if (!sample) return res.status(404).json({ error: 'Not found' });
  const results = db.results.filter(r => r.sample_id === id).sort((a, b) => tpSort(a.time_point) - tpSort(b.time_point));
  const images = db.images.filter(i => i.sample_id === id).sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at));
  res.json({ ...sample, results, images });
});

const DEFAULT_TEMPS = [
  { value: 25, na_tps: [] },
  { value: 45, na_tps: ['Initial'] },
  { value: 50, na_tps: ['Initial', '2_weeks'] },
];

app.post('/api/samples', (req, res) => {
  const { name, ref_no, date_started, remarks, temp_config, status, spec_ph_min, spec_ph_max, spec_visc_min, spec_visc_max } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Sample name is required' });
  const db = readDB();
  const toNum = v => (v != null && v !== '') ? Number(v) : null;
  const sample = {
    id: nextId(db, 'samples'),
    name: name.trim(), ref_no: ref_no || '', date_started: date_started || '', remarks: remarks || '',
    temp_config: JSON.stringify(temp_config || DEFAULT_TEMPS),
    status: status || 'active',
    spec_ph_min: toNum(spec_ph_min), spec_ph_max: toNum(spec_ph_max),
    spec_visc_min: toNum(spec_visc_min), spec_visc_max: toNum(spec_visc_max),
    created_at: now(),
  };
  db.samples.push(sample);
  writeDB(db);
  res.status(201).json({ ...sample, temp_config: JSON.parse(sample.temp_config) });
});

app.put('/api/samples/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, ref_no, date_started, remarks, temp_config, spec_ph_min, spec_ph_max, spec_visc_min, spec_visc_max } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Sample name is required' });
  const db = readDB();
  const idx = db.samples.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const toNum = v => (v != null && v !== '') ? Number(v) : null;
  const cur = db.samples[idx];
  db.samples[idx] = {
    ...cur, name: name.trim(), ref_no: ref_no || '', date_started: date_started || '', remarks: remarks || '',
    temp_config: JSON.stringify(temp_config || DEFAULT_TEMPS),
    spec_ph_min: spec_ph_min !== undefined ? toNum(spec_ph_min) : cur.spec_ph_min ?? null,
    spec_ph_max: spec_ph_max !== undefined ? toNum(spec_ph_max) : cur.spec_ph_max ?? null,
    spec_visc_min: spec_visc_min !== undefined ? toNum(spec_visc_min) : cur.spec_visc_min ?? null,
    spec_visc_max: spec_visc_max !== undefined ? toNum(spec_visc_max) : cur.spec_visc_max ?? null,
  };
  writeDB(db);
  const s = db.samples[idx];
  res.json({ ...s, temp_config: JSON.parse(s.temp_config) });
});

app.patch('/api/samples/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!['active', 'completed', 'failed', 'on_hold'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const db = readDB();
  const sample = db.samples.find(s => s.id === id);
  if (!sample) return res.status(404).json({ error: 'Not found' });
  sample.status = status;
  writeDB(db);
  res.json(sample);
});

app.delete('/api/samples/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = readDB();
  db.images.filter(i => i.sample_id === id).forEach(img => {
    const fp = path.join(uploadsDir, img.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });
  db.samples = db.samples.filter(s => s.id !== id);
  db.results = db.results.filter(r => r.sample_id !== id);
  db.images = db.images.filter(i => i.sample_id !== id);
  writeDB(db);
  res.json({ success: true });
});

// ── RESULTS ───────────────────────────────────────────────────────────────────

app.post('/api/samples/:id/results', (req, res) => {
  const sample_id = Number(req.params.id);
  const {
    time_point, ph_25, viscosity_25, ph_45, viscosity_45, ph_50, viscosity_50,
    spindle_25, rpm_25, spindle_45, rpm_45, spindle_50, rpm_50,
    notes, measured_at,
    appearance, color_obs, odor, phase_sep,
  } = req.body;
  if (!time_point) return res.status(400).json({ error: 'time_point required' });

  const toNum = v => (v === '' || v === null || v === undefined) ? null : Number(v);
  const db = readDB();
  const existing = db.results.find(r => r.sample_id === sample_id && r.time_point === time_point);

  const data = {
    sample_id, time_point,
    ph_25: toNum(ph_25), viscosity_25: toNum(viscosity_25),
    spindle_25: spindle_25 || null, rpm_25: toNum(rpm_25),
    ph_45: toNum(ph_45), viscosity_45: toNum(viscosity_45),
    spindle_45: spindle_45 || null, rpm_45: toNum(rpm_45),
    ph_50: toNum(ph_50), viscosity_50: toNum(viscosity_50),
    spindle_50: spindle_50 || null, rpm_50: toNum(rpm_50),
    notes: notes || '',
    measured_at: measured_at || today(),
    appearance: appearance || null,
    color_obs: color_obs || null,
    odor: odor || null,
    phase_sep: phase_sep || null,
  };

  let result;
  if (existing) {
    Object.assign(existing, data);
    result = existing;
  } else {
    result = { id: nextId(db, 'results'), ...data };
    db.results.push(result);
  }
  writeDB(db);
  res.json(result);
});

app.delete('/api/results/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = readDB();
  db.results = db.results.filter(r => r.id !== id);
  writeDB(db);
  res.json({ success: true });
});

// ── IMAGES ────────────────────────────────────────────────────────────────────

app.post('/api/samples/:id/images', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const sample_id = Number(req.params.id);
  const db = readDB();
  const image = { id: nextId(db, 'images'), sample_id, filename: req.file.filename, original_name: req.file.originalname, caption: req.body.caption || '', uploaded_at: now() };
  db.images.push(image);
  writeDB(db);
  res.status(201).json(image);
});

app.put('/api/images/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = readDB();
  const img = db.images.find(i => i.id === id);
  if (!img) return res.status(404).json({ error: 'Not found' });
  img.caption = req.body.caption || '';
  writeDB(db);
  res.json(img);
});

app.delete('/api/images/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = readDB();
  const img = db.images.find(i => i.id === id);
  if (img) {
    const fp = path.join(uploadsDir, img.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    db.images = db.images.filter(i => i.id !== id);
    writeDB(db);
  }
  res.json({ success: true });
});

// ── FORMULATIONS ─────────────────────────────────────────────────────────────

const DEFAULT_DISCLAIMER = 'This information is provided based on our technical data and present knowledge. However, we make no warranties, expressed or implied, and assume no liabilities in connection with any use of the information with respect to specific property, safety and suitability for a specific application. The suitability and safety of the final formulation should be confirmed in all respects by appropriate evaluation. It is also not guaranteed that use of the information does not fall within the scope of any intellectual property rights.';

app.get('/api/formulations', (req, res) => {
  const db = readDB();
  res.json(db.formulations.sort((a, b) => b.created_at.localeCompare(a.created_at)));
});

app.get('/api/formulations/:id', (req, res) => {
  const db = readDB();
  const f = db.formulations.find(x => x.id === Number(req.params.id));
  if (!f) return res.status(404).json({ error: 'Not found' });
  res.json(f);
});

app.post('/api/formulations', (req, res) => {
  const db = readDB();
  const f = {
    id: nextId(db, 'formulations'),
    product_name: req.body.product_name || '',
    ref_no: req.body.ref_no || '',
    description: req.body.description || '',
    bulk_size: req.body.bulk_size || 100,
    ingredients: req.body.ingredients || [],
    procedure: req.body.procedure || [],
    specifications: req.body.specifications || [],
    company_name: req.body.company_name || 'TECHNECTURE SDN BHD',
    company_address: req.body.company_address || 'No6, Jalan Spring 34/32, Golden Pavilion Industrial Park @Bukit Kemuning\nSeksyen 34, 40470 Shah Alam, Selangor.',
    company_tel: req.body.company_tel || '+603-51318868',
    company_fax: req.body.company_fax || '+603-51314899',
    logo_filename: req.body.logo_filename || '',
    ref_image_filename: req.body.ref_image_filename || '',
    disclaimer: req.body.disclaimer || DEFAULT_DISCLAIMER,
    remarks: req.body.remarks || '',
    created_at: now(),
  };
  db.formulations.push(f);
  writeDB(db);
  res.status(201).json(f);
});

app.put('/api/formulations/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = readDB();
  const idx = db.formulations.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.formulations[idx] = { ...db.formulations[idx], ...req.body, id, created_at: db.formulations[idx].created_at };
  writeDB(db);
  res.json(db.formulations[idx]);
});

app.delete('/api/formulations/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = readDB();
  const f = db.formulations.find(x => x.id === id);
  if (f) {
    [f.logo_filename, f.ref_image_filename].filter(Boolean).forEach(fn => {
      const fp = path.join(uploadsDir, fn);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });
  }
  db.formulations = db.formulations.filter(x => x.id !== id);
  writeDB(db);
  res.json({ success: true });
});

app.post('/api/formulations/:id/logo', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const id = Number(req.params.id);
  const db = readDB();
  const f = db.formulations.find(x => x.id === id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  if (f.logo_filename) { const old = path.join(uploadsDir, f.logo_filename); if (fs.existsSync(old)) fs.unlinkSync(old); }
  f.logo_filename = req.file.filename;
  writeDB(db);
  res.json({ filename: req.file.filename });
});

app.post('/api/formulations/:id/refimage', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const id = Number(req.params.id);
  const db = readDB();
  const f = db.formulations.find(x => x.id === id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  if (f.ref_image_filename) { const old = path.join(uploadsDir, f.ref_image_filename); if (fs.existsSync(old)) fs.unlinkSync(old); }
  f.ref_image_filename = req.file.filename;
  writeDB(db);
  res.json({ filename: req.file.filename });
});

// ── BACKUP / RESTORE ──────────────────────────────────────────────────────────

app.get('/api/backup/export', requireAdmin, (req, res) => {
  const db = readDB();
  const backup = {
    version: 1,
    app: 'FormuLab Hub',
    exported_at: new Date().toISOString(),
    samples: db.samples,
    results: db.results,
    images: db.images,
    formulations: db.formulations,
    users: db.users,
    _counters: db._counters,
  };
  const filename = `formulab-backup-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(backup, null, 2));
});

app.post('/api/backup/import', requireAdmin, express.json({ limit: '50mb' }), (req, res) => {
  const { version, samples, results, images, formulations, users, _counters } = req.body;
  if (!version || !Array.isArray(samples) || !Array.isArray(formulations)) {
    return res.status(400).json({ error: 'Invalid or unrecognised backup file' });
  }
  if (!Array.isArray(users) || !users.some(u => u.role === 'admin' && u.is_active)) {
    return res.status(400).json({ error: 'Backup must contain at least one active admin user' });
  }
  const db = readDB();
  db.samples = samples;
  db.results = results || [];
  db.images = images || [];
  db.formulations = formulations;
  db.users = users;
  if (_counters) db._counters = _counters;
  logAudit(db, req.user.id, req.user.username, 'backup_restored', req.ip || '', 'Data restored from backup');
  writeDB(db);
  res.json({
    success: true,
    stats: { samples: db.samples.length, formulations: db.formulations.length, users: db.users.length },
  });
});

// ── Production static serve ───────────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client/dist')));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'client/dist/index.html')));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Stability Test App running at:\n  -> http://localhost:${PORT}\n`);
});
