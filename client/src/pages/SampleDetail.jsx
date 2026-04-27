import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getSample, updateSample, upsertResult, deleteResult, uploadImage, updateImageCaption, deleteImage, getFormulations } from '../api'
import DataEntryModal from '../components/DataEntryModal'
import Charts from '../components/Charts'
import { generatePDF } from '../pdfReport'

// ── Constants ────────────────────────────────────────────────────────────────

const TIME_POINTS = ['Initial', '2_weeks', '1_month', '2_months', '3_months']
const TIME_LABELS = { Initial: 'Initial', '2_weeks': '2 Weeks', '1_month': '1 Month', '2_months': '2 Months', '3_months': '3 Months' }
const SUFFIXES = ['25', '45', '50']
const DEFAULT_TEMPS = [
  { value: 25, na_tps: [] },
  { value: 45, na_tps: ['Initial'] },
  { value: 50, na_tps: ['Initial', '2_weeks'] },
]
const TEMP_HEADER_COLORS = ['bg-blue-50 text-blue-700', 'bg-amber-50 text-amber-700', 'bg-red-50 text-red-700']
const TEMP_SUBHEADER = ['bg-blue-50/50', 'bg-amber-50/50', 'bg-red-50/50']
const fmt = v => (v === null || v === undefined || v === '') ? null : Number(v).toFixed(2)

function parseTempConfig(raw) {
  if (!raw) return DEFAULT_TEMPS
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return DEFAULT_TEMPS }
}

// ── Inline-editable Notes Cell ────────────────────────────────────────────────

function NotesCell({ row, timePoint, onSave }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(row?.notes || '')
  useEffect(() => { setVal(row?.notes || '') }, [row?.notes])

  function save() {
    setEditing(false)
    const prev = row?.notes || ''
    if (val !== prev) onSave(timePoint, val)
  }

  if (editing) {
    return (
      <td className="border border-gray-200 px-1 py-1 min-w-[120px]">
        <input
          autoFocus
          className="w-full text-xs px-2 py-1 border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={save}
          onKeyDown={e => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') { setEditing(false); setVal(row?.notes || '') }
          }}
          placeholder="Type notes..."
        />
      </td>
    )
  }
  return (
    <td
      className="border border-gray-200 px-2 py-2 text-xs cursor-text hover:bg-yellow-50 transition-colors min-w-[100px]"
      onClick={() => setEditing(true)}
      title="Click to edit notes"
    >
      {val || <span className="text-gray-300 italic">add note...</span>}
    </td>
  )
}

// ── Results Table ─────────────────────────────────────────────────────────────

function ResultsTable({ results, temps, onCellClick, onClearRow, onSaveNotes }) {
  const byTP = Object.fromEntries(results.map(r => [r.time_point, r]))

  function DataCell({ tp, suffix, tempIdx }) {
    const isNA = (temps[tempIdx]?.na_tps || []).includes(tp)
    if (isNA) return <td className="na-cell border border-gray-200 px-2 py-2 text-xs">—</td>
    const row = byTP[tp]
    const phVal = fmt(row?.[`ph_${suffix}`])
    const viscVal = fmt(row?.[`viscosity_${suffix}`])
    return (
      <>
        <td className="border border-gray-200 px-2 py-2 text-xs text-center cursor-pointer hover:bg-blue-50 transition-colors font-medium"
          onClick={() => onCellClick(tp)} title="Click to edit">
          {phVal ?? <span className="text-gray-300">+</span>}
        </td>
        <td className="border border-gray-200 px-2 py-2 text-xs text-center cursor-pointer hover:bg-blue-50 transition-colors font-medium"
          onClick={() => onCellClick(tp)} title="Click to edit">
          {viscVal ?? <span className="text-gray-300">+</span>}
        </td>
      </>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="border border-gray-200 px-3 py-2.5 text-left font-semibold text-gray-700 w-24" rowSpan={2}>Duration</th>
            {temps.map((t, i) => (
              <th key={i} colSpan={2} className={`border border-gray-200 px-2 py-2.5 text-center font-semibold ${TEMP_HEADER_COLORS[i]}`}>
                {t.value}°C
              </th>
            ))}
            <th className="border border-gray-200 px-2 py-2.5 text-center font-semibold text-gray-700" rowSpan={2}>Spindle #</th>
            <th className="border border-gray-200 px-2 py-2.5 text-center font-semibold text-gray-700" rowSpan={2}>RPM</th>
            <th className="border border-gray-200 px-2 py-2.5 text-center font-semibold text-gray-700" rowSpan={2}>
              Notes <span className="font-normal text-gray-400 text-xs">(click to edit)</span>
            </th>
            <th className="border border-gray-200 px-2 py-2.5 w-8" rowSpan={2}></th>
          </tr>
          <tr className="bg-gray-50 text-gray-500">
            {temps.map((_, i) => (
              <>
                <th key={`ph-${i}`} className={`border border-gray-200 px-2 py-1.5 text-center font-medium ${TEMP_SUBHEADER[i]}`}>pH</th>
                <th key={`v-${i}`} className={`border border-gray-200 px-2 py-1.5 text-center font-medium ${TEMP_SUBHEADER[i]}`}>Viscosity</th>
              </>
            ))}
          </tr>
        </thead>
        <tbody>
          {TIME_POINTS.map((tp, i) => {
            const row = byTP[tp]
            return (
              <tr key={tp} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                <td className="border border-gray-200 px-3 py-2 font-medium text-gray-700 cursor-pointer hover:bg-blue-50 transition-colors"
                  onClick={() => onCellClick(tp)}>
                  {TIME_LABELS[tp]}
                  {row && <span className="ml-1.5 text-green-500">●</span>}
                </td>
                {temps.map((_, i) => (
                  <DataCell key={i} tp={tp} suffix={SUFFIXES[i]} tempIdx={i} />
                ))}
                <td className="border border-gray-200 px-2 py-2 text-xs text-center text-gray-600">
                  {row?.spindle || <span className="text-gray-300">—</span>}
                </td>
                <td className="border border-gray-200 px-2 py-2 text-xs text-center text-gray-600">
                  {row?.rpm != null && row?.rpm !== '' ? row.rpm : <span className="text-gray-300">—</span>}
                </td>
                <NotesCell row={row} timePoint={tp} onSave={onSaveNotes} />
                <td className="border border-gray-200 px-2 py-2 text-center">
                  {row && (
                    <button onClick={() => onClearRow(row.id)}
                      className="text-gray-300 hover:text-red-500 text-sm transition-colors" title="Clear row">✕</button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Image Gallery ─────────────────────────────────────────────────────────────

function ImageGallery({ sampleId, images, onUpdate }) {
  const fileRef = useRef()
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [editCaption, setEditCaption] = useState({})

  async function handleUpload(e) {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    try { for (const f of files) await uploadImage(sampleId, f) }
    finally { setUploading(false); e.target.value = ''; onUpdate() }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this image?')) return
    await deleteImage(id); onUpdate()
  }

  async function saveCaption(img) {
    await updateImageCaption(img.id, editCaption[img.id] ?? img.caption)
    setEditCaption(prev => { const n = { ...prev }; delete n[img.id]; return n })
    onUpdate()
  }

  return (
    <div>
      <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-all mb-5"
        onClick={() => fileRef.current.click()}>
        <input ref={fileRef} type="file" className="hidden" accept="image/*,.pdf" multiple onChange={handleUpload} />
        <p className="text-2xl mb-2">{uploading ? '⏳' : '📸'}</p>
        <p className="text-sm text-gray-600 font-medium">{uploading ? 'Uploading...' : 'Click to upload images'}</p>
        <p className="text-xs text-gray-400 mt-1">JPG, PNG, GIF, WebP, PDF — up to 20MB each</p>
      </div>
      {images.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-4">No images uploaded yet</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {images.map(img => (
            <div key={img.id} className="group relative card overflow-hidden">
              <div className="aspect-square bg-gray-100 flex items-center justify-center cursor-pointer"
                onClick={() => setLightbox(img)}>
                {/\.(jpe?g|png|gif|webp)$/i.test(img.filename)
                  ? <img src={`/uploads/${img.filename}`} alt={img.caption} className="w-full h-full object-cover" />
                  : <div className="text-3xl">📄</div>}
              </div>
              <div className="p-2">
                <input className="w-full text-xs border-0 bg-transparent text-gray-500 focus:outline-none"
                  placeholder="Add caption..."
                  value={editCaption[img.id] !== undefined ? editCaption[img.id] : (img.caption || '')}
                  onChange={e => setEditCaption(p => ({ ...p, [img.id]: e.target.value }))}
                  onBlur={() => editCaption[img.id] !== undefined && saveCaption(img)}
                  onKeyDown={e => e.key === 'Enter' && saveCaption(img)} />
                <p className="text-xs text-gray-300 truncate">{img.original_name}</p>
              </div>
              <button onClick={() => handleDelete(img.id)}
                className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">✕</button>
            </div>
          ))}
        </div>
      )}
      {lightbox && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <div className="relative max-w-4xl max-h-full">
            <img src={`/uploads/${lightbox.filename}`} alt={lightbox.caption} className="max-w-full max-h-screen object-contain rounded-lg" />
            {lightbox.caption && <p className="text-center text-white text-sm mt-2">{lightbox.caption}</p>}
            <button className="absolute -top-3 -right-3 w-8 h-8 bg-white text-gray-800 rounded-full font-bold"
              onClick={() => setLightbox(null)}>✕</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Temperature Config Editor ─────────────────────────────────────────────────

function TempConfigEditor({ temps, onChange }) {
  const colors = ['blue', 'amber', 'red']
  const tpOptions = TIME_POINTS

  function setTempValue(i, val) {
    const next = temps.map((t, idx) => idx === i ? { ...t, value: Number(val) || 0 } : t)
    onChange(next)
  }

  function toggleNA(i, tp) {
    const next = temps.map((t, idx) => {
      if (idx !== i) return t
      const na = t.na_tps.includes(tp) ? t.na_tps.filter(x => x !== tp) : [...t.na_tps, tp]
      return { ...t, na_tps: na }
    })
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Set temperature values and mark which time points are not applicable (N/A) for each condition.</p>
      {temps.map((t, i) => (
        <div key={i} className={`rounded-xl border p-3 bg-${colors[i]}-50/40 border-${colors[i]}-100`}>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                className="input w-20 text-sm font-semibold"
                value={t.value}
                onChange={e => setTempValue(i, e.target.value)}
                min={0} max={200}
              />
              <span className="text-sm text-gray-600 font-medium">°C</span>
            </div>
            <span className="text-xs text-gray-400">N/A at:</span>
            <div className="flex flex-wrap gap-1.5">
              {tpOptions.map(tp => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => toggleNA(i, tp)}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                    t.na_tps.includes(tp)
                      ? 'bg-gray-400 text-white border-gray-400'
                      : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  {TIME_LABELS[tp]}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Edit Sample Modal ─────────────────────────────────────────────────────────

function EditSampleModal({ sample, onClose, onSave }) {
  const [form, setForm] = useState({
    name: sample.name, ref_no: sample.ref_no || '',
    date_started: sample.date_started || '', remarks: sample.remarks || '',
  })
  const [temps, setTemps] = useState(parseTempConfig(sample.temp_config))
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try { onSave(await updateSample(sample.id, { ...form, temp_config: temps })); onClose() }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold">Edit Sample</h2>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div><label className="label">Sample Name *</label>
            <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Ref No</label>
              <input className="input" value={form.ref_no} onChange={e => setForm(f => ({ ...f, ref_no: e.target.value }))} /></div>
            <div><label className="label">Date Started</label>
              <input type="date" className="input" value={form.date_started} onChange={e => setForm(f => ({ ...f, date_started: e.target.value }))} /></div>
          </div>
          <div><label className="label">Remarks</label>
            <textarea className="input resize-none" rows={2} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} /></div>

          <div>
            <label className="label mb-2">Temperature Conditions</label>
            <TempConfigEditor temps={temps} onChange={setTemps} />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS = ['Data', 'Charts', 'Images', 'Report']

export default function SampleDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [sample, setSample] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('Data')
  const [entry, setEntry] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [genPDF, setGenPDF] = useState(false)
  const [linkedFormulation, setLinkedFormulation] = useState(null)

  const load = async () => {
    try { setSample(await getSample(id)) }
    catch { navigate('/') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [id])

  useEffect(() => {
    getFormulations().then(fmts => {
      const linked = fmts.find(f => f.linked_sample_id === Number(id))
      setLinkedFormulation(linked || null)
    }).catch(() => {})
  }, [id])

  const temps = sample ? parseTempConfig(sample.temp_config) : DEFAULT_TEMPS

  async function handleSaveResult(data) {
    const r = await upsertResult(id, data)
    setSample(prev => ({
      ...prev,
      results: [...prev.results.filter(x => x.time_point !== r.time_point), r]
    }))
  }

  async function handleSaveNotes(timePoint, notes) {
    const existing = sample.results.find(r => r.time_point === timePoint)
    if (existing) {
      const r = await upsertResult(id, { ...existing, notes })
      setSample(prev => ({
        ...prev,
        results: [...prev.results.filter(x => x.time_point !== r.time_point), r]
      }))
    } else {
      const r = await upsertResult(id, { time_point: timePoint, notes })
      setSample(prev => ({ ...prev, results: [...prev.results, r] }))
    }
  }

  async function handleClearRow(resultId) {
    if (!confirm('Clear this time point data?')) return
    await deleteResult(resultId)
    setSample(prev => ({ ...prev, results: prev.results.filter(r => r.id !== resultId) }))
  }

  async function handleGeneratePDF() {
    setGenPDF(true)
    try { await generatePDF({ ...sample, temps }) }
    finally { setGenPDF(false) }
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>
  if (!sample) return null

  const completed = sample.results.length
  const pct = Math.round((completed / 5) * 100)

  return (
    <>
      {entry && (
        <DataEntryModal
          timePoint={entry}
          existing={sample.results.find(r => r.time_point === entry)}
          temps={temps}
          onSave={handleSaveResult}
          onClose={() => setEntry(null)}
        />
      )}
      {editOpen && (
        <EditSampleModal
          sample={sample}
          onClose={() => setEditOpen(false)}
          onSave={s => setSample(prev => ({ ...prev, ...s, temp_config: s.temp_config }))}
        />
      )}

      {/* Header */}
      <div className="card p-5 mb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">{sample.name}</h1>
              {sample.ref_no && <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{sample.ref_no}</span>}
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${pct === 100 ? 'bg-green-100 text-green-700' : pct > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                {pct === 100 ? 'Complete' : pct > 0 ? 'In Progress' : 'Pending'}
              </span>
            </div>
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-500">
              {sample.date_started && <span>📅 {sample.date_started}</span>}
              <span>✅ {completed}/5 time points</span>
              <span>🌡 {temps.map(t => `${t.value}°C`).join(' · ')}</span>
              <span>📸 {sample.images.length} images</span>
            </div>
            {sample.remarks && <p className="mt-1 text-sm text-gray-500 italic">"{sample.remarks}"</p>}
            {linkedFormulation && (
              <Link to={`/formulations/${linkedFormulation.id}`}
                className="inline-flex items-center gap-1.5 mt-1.5 text-xs text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-0.5 rounded-full hover:bg-purple-100 transition-colors">
                📋 Formulation: {linkedFormulation.product_name || 'View Sheet'} →
              </Link>
            )}
          </div>
          <button className="btn-secondary text-xs py-1.5 shrink-0" onClick={() => setEditOpen(true)}>Edit</button>
        </div>
        <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit no-print">
        {TABS.map(t => (
          <button key={t}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Data' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500">Click any cell or row label to enter measurements · Click Notes column to type directly</p>
            <div className="flex gap-2">
              {TIME_POINTS.filter(tp => !sample.results.find(r => r.time_point === tp)).slice(0, 1).map(tp => (
                <button key={tp} className="btn-primary text-xs py-1.5" onClick={() => setEntry(tp)}>
                  + {TIME_LABELS[tp]}
                </button>
              ))}
            </div>
          </div>
          <ResultsTable
            results={sample.results}
            temps={temps}
            onCellClick={tp => setEntry(tp)}
            onClearRow={handleClearRow}
            onSaveNotes={handleSaveNotes}
          />
          <p className="text-xs text-gray-400 mt-2">
            Greyed cells (—) are N/A for that temperature condition · Edit sample to change temperatures or N/A rules
          </p>
        </div>
      )}

      {tab === 'Charts' && <Charts results={sample.results} temps={temps} />}

      {tab === 'Images' && <ImageGallery sampleId={id} images={sample.images} onUpdate={load} />}

      {tab === 'Report' && (
        <div>
          <div className="card p-6 mb-5 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">Generate PDF Report</h3>
              <p className="text-sm text-gray-500 mt-0.5">Landscape A4 matching the stability test template</p>
            </div>
            <button className="btn-primary" onClick={handleGeneratePDF} disabled={genPDF}>
              {genPDF ? '⏳ Generating...' : '⬇ Download PDF'}
            </button>
          </div>
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Stability Test Result</h2>
              <div className="text-right text-xs text-gray-500">
                <p className="font-semibold">{sample.name}</p>
                {sample.ref_no && <p>Ref: {sample.ref_no}</p>}
                {sample.date_started && <p>Started: {sample.date_started}</p>}
              </div>
            </div>
            <ResultsTable
              results={sample.results}
              temps={temps}
              onCellClick={tp => { setTab('Data'); setEntry(tp) }}
              onClearRow={handleClearRow}
              onSaveNotes={handleSaveNotes}
            />
          </div>
        </div>
      )}
    </>
  )
}
