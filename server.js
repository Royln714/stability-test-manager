const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// DATA_DIR lets cloud hosts (Railway, Render) mount a persistent volume
const DATA_DIR = process.env.DATA_DIR || __dirname;
const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── JSON file database ────────────────────────────────────────────────────────

const DB_FILE = path.join(DATA_DIR, 'stability_data.json');

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    return { _counters: { samples: 0, results: 0, images: 0, formulations: 0 }, samples: [], results: [], images: [], formulations: [] };
  }
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  if (!data.formulations) data.formulations = [];
  if (!data._counters.formulations) data._counters.formulations = 0;
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

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

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
  const { name, ref_no, date_started, remarks, temp_config } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Sample name is required' });
  const db = readDB();
  const sample = {
    id: nextId(db, 'samples'),
    name: name.trim(), ref_no: ref_no || '', date_started: date_started || '', remarks: remarks || '',
    temp_config: JSON.stringify(temp_config || DEFAULT_TEMPS),
    created_at: now(),
  };
  db.samples.push(sample);
  writeDB(db);
  res.status(201).json({ ...sample, temp_config: JSON.parse(sample.temp_config) });
});

app.put('/api/samples/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, ref_no, date_started, remarks, temp_config } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Sample name is required' });
  const db = readDB();
  const idx = db.samples.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.samples[idx] = {
    ...db.samples[idx], name: name.trim(), ref_no: ref_no || '', date_started: date_started || '', remarks: remarks || '',
    temp_config: JSON.stringify(temp_config || DEFAULT_TEMPS),
  };
  writeDB(db);
  const s = db.samples[idx];
  res.json({ ...s, temp_config: JSON.parse(s.temp_config) });
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
  const { time_point, ph_25, viscosity_25, ph_45, viscosity_45, ph_50, viscosity_50, notes, measured_at } = req.body;
  if (!time_point) return res.status(400).json({ error: 'time_point required' });

  const toNum = v => (v === '' || v === null || v === undefined) ? null : Number(v);
  const db = readDB();
  const existing = db.results.find(r => r.sample_id === sample_id && r.time_point === time_point);

  const data = {
    sample_id, time_point,
    ph_25: toNum(ph_25), viscosity_25: toNum(viscosity_25),
    ph_45: toNum(ph_45), viscosity_45: toNum(viscosity_45),
    ph_50: toNum(ph_50), viscosity_50: toNum(viscosity_50),
    notes: notes || '',
    measured_at: measured_at || today(),
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

// ── Production static serve ───────────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client/dist')));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'client/dist/index.html')));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Stability Test App running at:\n  -> http://localhost:${PORT}\n`);
});
