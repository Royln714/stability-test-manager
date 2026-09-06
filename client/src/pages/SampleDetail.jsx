import { useState, useEffect, useRef, Fragment } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getSample, updateSample, updateSampleStatus, upsertResult, deleteResult, uploadImage, updateImageCaption, deleteImage, getFormulations, duplicateSample } from '../api'
import DataEntryModal from '../components/DataEntryModal'
import Charts from '../components/Charts'
import { generatePDF, generateAnalysisPDF } from '../pdfReport'
import * as XLSX from 'xlsx'

// ── Constants ────────────────────────────────────────────────────────────────

const TIME_POINTS = ['Initial', '2_weeks', '1_month', '2_months', '3_months']
const TIME_LABELS = { Initial: 'Initial', '2_weeks': '2 Weeks', '1_month': '1 Month', '2_months': '2 Months', '3_months': '3 Months' }
const SUFFIXES = ['25', '45', '50']
const DEFAULT_TEMPS = [
  { value: 25, na_tps: [] },
  { value: 45, na_tps: ['Initial'] },
  { value: 50, na_tps: ['Initial'] },
]
const TEMP_HEADER_COLORS = ['bg-blue-50 text-blue-700', 'bg-amber-50 text-amber-700', 'bg-red-50 text-red-700']

const STATUS_CFG = {
  active:    { label: 'Active',    color: 'bg-blue-100 text-blue-700' },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-700' },
  failed:    { label: 'Failed',    color: 'bg-red-100 text-red-700' },
  on_hold:   { label: 'On Hold',   color: 'bg-amber-100 text-amber-700' },
}
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

// ── Inline Editable Result Cell ───────────────────────────────────────────────

function specClass(value, min, max) {
  if (value === null || value === undefined || value === '') return ''
  const n = Number(value)
  if ((min !== null && min !== undefined && n < min) || (max !== null && max !== undefined && n > max))
    return 'bg-red-50 text-red-700'
  if (min !== null && min !== undefined || max !== null && max !== undefined)
    return 'bg-green-50 text-green-700'
  return ''
}

function InlineResultCell({ value, onSave, type = 'number', specMin, specMax, decimals = 2 }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value ?? '')
  useEffect(() => { setVal(value ?? '') }, [value])

  function commit() {
    setEditing(false)
    if (String(val) !== String(value ?? '')) onSave(val)
  }

  const display = type === 'number' && value !== null && value !== undefined && value !== ''
    ? (decimals === null ? String(Number(value)) : Number(value).toFixed(decimals)) : value
  const sc = type === 'number' ? specClass(value, specMin, specMax) : ''

  if (editing) {
    return (
      <td className="border border-gray-200 px-1 py-0.5">
        <input
          autoFocus
          type={type}
          step={type === 'number' ? 'any' : undefined}
          className="w-full text-xs px-1 py-1 border border-blue-400 rounded focus:outline-none text-center"
          style={{ minWidth: 44 }}
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setEditing(false); setVal(value ?? '') }
          }}
        />
      </td>
    )
  }
  return (
    <td
      className={`border border-gray-200 px-2 py-2 text-xs text-center cursor-pointer transition-colors font-medium ${sc || 'hover:bg-blue-50'}`}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {display !== null && display !== undefined && display !== ''
        ? display
        : <span className="text-gray-300">+</span>}
    </td>
  )
}

// ── Results Table ─────────────────────────────────────────────────────────────

function OrganoCell({ row, field, timePoint, onSave, placeholder = '' }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(row?.[field] || '')
  useEffect(() => { setVal(row?.[field] || '') }, [row?.[field]])

  function commit() {
    setEditing(false)
    if (val !== (row?.[field] || '')) onSave(timePoint, field, val)
  }

  if (editing) {
    return (
      <td className="border border-gray-200 px-1 py-0.5 min-w-[80px]">
        <input autoFocus className="w-full text-xs px-1 py-1 border border-purple-400 rounded focus:outline-none"
          value={val} onChange={e => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setVal(row?.[field] || '') } }}
          placeholder={placeholder} />
      </td>
    )
  }
  return (
    <td className="border border-gray-200 px-2 py-2 text-xs text-center cursor-pointer hover:bg-purple-50 transition-colors"
      onClick={() => setEditing(true)} title="Click to edit">
      {val || <span className="text-gray-300">+</span>}
    </td>
  )
}

function ResultsTable({ results, temps, onCellClick, onClearRow, onSaveNotes, onSaveCell, specPhMin, specPhMax, specViscMin, specViscMax }) {
  const byTP = Object.fromEntries(results.map(r => [r.time_point, r]))

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="w-full text-xs border-collapse" style={{ minWidth: 900 }}>
        <thead>
          <tr className="bg-gray-50">
            <th className="border border-gray-200 px-3 py-2.5 text-left font-semibold text-gray-700 w-24" rowSpan={2}>Duration</th>
            {temps.map((t, i) => (
              <th key={i} colSpan={6} className={`border border-gray-200 px-2 py-2.5 text-center font-semibold ${TEMP_HEADER_COLORS[i]}`}>
                {t.value}°C
              </th>
            ))}
            <th colSpan={4} className="border border-gray-200 px-2 py-2.5 text-center font-semibold bg-purple-50 text-purple-700">Organoleptic</th>
            <th className="border border-gray-200 px-2 py-2.5 text-center font-semibold text-teal-700 bg-teal-50" rowSpan={2}>Microbial</th>
            <th className="border border-gray-200 px-2 py-2.5 text-center font-semibold text-gray-700" rowSpan={2}>Notes</th>
            <th className="border border-gray-200 px-2 py-2.5 w-8" rowSpan={2}></th>
          </tr>
          <tr className="bg-gray-50 text-gray-500">
            {temps.map((_, i) => (
              <Fragment key={i}>
                <th className={`border border-gray-200 px-2 py-1.5 text-center font-medium ${TEMP_SUBHEADER[i]}`}>pH</th>
                <th className={`border border-gray-200 px-2 py-1.5 text-center font-medium ${TEMP_SUBHEADER[i]}`}>Visc</th>
                <th className={`border border-gray-200 px-2 py-1.5 text-center font-medium ${TEMP_SUBHEADER[i]}`}>SG</th>
                <th className={`border border-gray-200 px-2 py-1.5 text-center font-medium ${TEMP_SUBHEADER[i]}`}>NTU</th>
                <th className={`border border-gray-200 px-2 py-1.5 text-center font-medium ${TEMP_SUBHEADER[i]}`}>Spindle</th>
                <th className={`border border-gray-200 px-2 py-1.5 text-center font-medium ${TEMP_SUBHEADER[i]}`}>RPM</th>
              </Fragment>
            ))}
            <th className="border border-gray-200 px-2 py-1.5 text-center font-medium bg-purple-50/50">Appearance</th>
            <th className="border border-gray-200 px-2 py-1.5 text-center font-medium bg-purple-50/50">Color</th>
            <th className="border border-gray-200 px-2 py-1.5 text-center font-medium bg-purple-50/50">Odor</th>
            <th className="border border-gray-200 px-2 py-1.5 text-center font-medium bg-purple-50/50">Phase Sep</th>
          </tr>
        </thead>
        <tbody>
          {TIME_POINTS.map((tp, i) => {
            const row = byTP[tp]
            return (
              <tr key={tp} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                <td
                  className="border border-gray-200 px-3 py-2 font-medium text-gray-700 cursor-pointer hover:bg-blue-50 transition-colors"
                  onClick={() => onCellClick(tp)}
                >
                  {TIME_LABELS[tp]}
                  {row && <span className="ml-1.5 text-green-500">●</span>}
                </td>
                {temps.map((t, tempIdx) => {
                  const suf = SUFFIXES[tempIdx]
                  const isNA = (t.na_tps || []).includes(tp)
                  if (isNA) {
                    return (
                      <td key={tempIdx} colSpan={6}
                        className="na-cell border border-gray-200 px-2 py-2 text-center text-gray-300 bg-gray-50">—</td>
                    )
                  }
                  return (
                    <Fragment key={tempIdx}>
                      <InlineResultCell value={row?.[`ph_${suf}`]} onSave={v => onSaveCell(tp, `ph_${suf}`, v)} specMin={specPhMin} specMax={specPhMax} />
                      <InlineResultCell value={row?.[`viscosity_${suf}`]} onSave={v => onSaveCell(tp, `viscosity_${suf}`, v)} decimals={null} specMin={specViscMin} specMax={specViscMax} />
                      <InlineResultCell value={row?.[`sg_${suf}`]} onSave={v => onSaveCell(tp, `sg_${suf}`, v)} decimals={null} />
                      <InlineResultCell value={row?.[`turbidity_${suf}`]} onSave={v => onSaveCell(tp, `turbidity_${suf}`, v)} decimals={null} />
                      <InlineResultCell value={row?.[`spindle_${suf}`]} type="text" onSave={v => onSaveCell(tp, `spindle_${suf}`, v)} />
                      <InlineResultCell value={row?.[`rpm_${suf}`]} onSave={v => onSaveCell(tp, `rpm_${suf}`, v)} decimals={0} />
                    </Fragment>
                  )
                })}
                <OrganoCell row={row} field="appearance" timePoint={tp} onSave={onSaveCell} placeholder="e.g. Clear" />
                <OrganoCell row={row} field="color_obs"   timePoint={tp} onSave={onSaveCell} placeholder="e.g. White" />
                <OrganoCell row={row} field="odor"        timePoint={tp} onSave={onSaveCell} placeholder="e.g. Normal" />
                <OrganoCell row={row} field="phase_sep"   timePoint={tp} onSave={onSaveCell} placeholder="None" />
                <OrganoCell row={row} field="microbial"   timePoint={tp} onSave={onSaveCell} placeholder="e.g. <10" />
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
                {img.url && /\.(jpe?g|png|gif|webp)$/i.test(img.original_name || img.filename || '')
                  ? <img src={img.url} alt={img.caption} className="w-full h-full object-cover" />
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
            <img src={lightbox.url} alt={lightbox.caption} className="max-w-full max-h-screen object-contain rounded-lg" />
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
    spec_ph_min: sample.spec_ph_min ?? '', spec_ph_max: sample.spec_ph_max ?? '',
    spec_visc_min: sample.spec_visc_min ?? '', spec_visc_max: sample.spec_visc_max ?? '',
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
            <label className="label mb-2">Spec Limits (optional — cells turn red/green automatically)</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-xs text-gray-400">pH Min</label>
                <input type="number" step="any" className="input" placeholder="e.g. 5.0"
                  value={form.spec_ph_min} onChange={e => setForm(f => ({ ...f, spec_ph_min: e.target.value }))} />
              </div>
              <div>
                <label className="label text-xs text-gray-400">pH Max</label>
                <input type="number" step="any" className="input" placeholder="e.g. 7.0"
                  value={form.spec_ph_max} onChange={e => setForm(f => ({ ...f, spec_ph_max: e.target.value }))} />
              </div>
              <div>
                <label className="label text-xs text-gray-400">Viscosity Min (cP)</label>
                <input type="number" step="any" className="input" placeholder="e.g. 5000"
                  value={form.spec_visc_min} onChange={e => setForm(f => ({ ...f, spec_visc_min: e.target.value }))} />
              </div>
              <div>
                <label className="label text-xs text-gray-400">Viscosity Max (cP)</label>
                <input type="number" step="any" className="input" placeholder="e.g. 15000"
                  value={form.spec_visc_max} onChange={e => setForm(f => ({ ...f, spec_visc_max: e.target.value }))} />
              </div>
            </div>
          </div>

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

// ── Microscope Image Gallery ──────────────────────────────────────────────────

const MAG_OPTIONS = ['40x', '100x', '200x', '400x', '500x', '1000x']
const LIGHT_OPTIONS = ['Brightfield', 'Polarized']
const TEMP_OPTIONS = ['RT', '45°C', '50°C']

function MicroscopeGallery({ sampleId, images, onUpdate }) {
  const fileRefs = useRef({})
  const [uploading, setUploading] = useState(null)
  const [lightbox, setLightbox] = useState(null)
  const [magnification, setMagnification] = useState({})
  const [lightMode, setLightMode] = useState({})
  const [tempCond, setTempCond] = useState({})
  const [imgComments, setImgComments] = useState(() => {
    try { return JSON.parse(localStorage.getItem('micro_comments') || '{}') } catch { return {} }
  })

  function setImgComment(imgId, val) {
    const next = { ...imgComments, [imgId]: val }
    setImgComments(next)
    try { localStorage.setItem('micro_comments', JSON.stringify(next)) } catch {}
  }

  async function handleUpload(tp, e) {
    const files = Array.from(e.target.files)
    if (!files.length) return
    const mag = magnification[tp] || ''
    const mode = lightMode[tp] || ''
    const temp = tp !== 'Initial' ? (tempCond[tp] || '') : ''
    const caption = [mag, mode, temp].filter(Boolean).join(' | ')
    setUploading(tp)
    try {
      for (const f of files) await uploadImage(sampleId, f, caption, 'microscope', tp)
    } finally { setUploading(null); e.target.value = ''; onUpdate() }
  }

  async function handleDelete(imgId) {
    if (!confirm('Delete this microscope image?')) return
    await deleteImage(imgId); onUpdate()
  }

  return (
    <div>
      <h3 className="font-semibold text-gray-800 mb-4">Microscope Images by Time Point</h3>
      <div className="space-y-3">
        {TIME_POINTS.map(tp => {
          const tpImgs = images.filter(img =>
            img.category === 'microscope' && img.time_point === tp &&
            /\.(jpe?g|png|gif|webp)$/i.test(img.original_name || img.filename || ''))
          return (
            <div key={tp} className="rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-blue-700">{TIME_LABELS[tp]}</span>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <select
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700"
                    value={magnification[tp] || ''}
                    onChange={e => setMagnification(m => ({ ...m, [tp]: e.target.value }))}>
                    <option value="">— Magnification —</option>
                    {MAG_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700"
                    value={lightMode[tp] || ''}
                    onChange={e => setLightMode(m => ({ ...m, [tp]: e.target.value }))}>
                    <option value="">— Light Mode —</option>
                    {LIGHT_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  {tp !== 'Initial' && (
                    <select
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700"
                      value={tempCond[tp] || ''}
                      onChange={e => setTempCond(m => ({ ...m, [tp]: e.target.value }))}>
                      <option value="">— Temp —</option>
                      {TEMP_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  )}
                  <input ref={el => fileRefs.current[tp] = el} type="file" className="hidden"
                    accept="image/*" multiple onChange={e => handleUpload(tp, e)} />
                  <button className="btn-secondary text-xs py-1"
                    onClick={() => fileRefs.current[tp]?.click()} disabled={uploading === tp}>
                    {uploading === tp ? 'Uploading...' : '+ Add'}
                  </button>
                </div>
              </div>
              {tpImgs.length === 0
                ? <p className="text-xs text-gray-400 italic">No microscope images for this time point</p>
                : (
                  <div className="space-y-2 w-full">
                    {tpImgs.map(img => (
                      <div key={img.id} className="flex gap-3 items-start bg-gray-50 rounded-xl p-2 border border-gray-100">
                        <div className="relative w-24 h-24 shrink-0 rounded-lg overflow-hidden border border-gray-200 cursor-pointer group"
                          onClick={() => setLightbox(img)}>
                          <img src={img.url} alt={img.caption} className="w-full h-full object-cover" />
                          <button onClick={e => { e.stopPropagation(); handleDelete(img.id) }}
                            className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">✕</button>
                        </div>
                        <div className="flex-1 space-y-1">
                          {img.caption && (
                            <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-medium">
                              {img.caption}
                            </span>
                          )}
                          <textarea
                            className="input resize-none w-full text-xs"
                            rows={3}
                            placeholder="Comment / observation for this image..."
                            value={imgComments[img.id] || ''}
                            onChange={e => setImgComment(img.id, e.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          )
        })}
      </div>
      {lightbox && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <div className="relative max-w-4xl max-h-full">
            <img src={lightbox.url} alt={lightbox.caption} className="max-w-full max-h-screen object-contain rounded-lg" />
            {lightbox.caption && <p className="text-center text-white text-sm mt-2">{lightbox.caption}</p>}
            <button className="absolute -top-3 -right-3 w-8 h-8 bg-white text-gray-800 rounded-full font-bold" onClick={() => setLightbox(null)}>✕</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Analysis Report Preview ───────────────────────────────────────────────────

const DEFAULT_DISCLAIMER = 'This stability analysis report is intended for internal research and development purposes only. The results presented are based on controlled laboratory testing conditions and may not reflect real-world performance. All data should be reviewed by a qualified chemist before use in product commercialisation decisions.'

function AnalysisReport({ sample, onGeneratePDF, generating }) {
  const storageKey = `analysis_${sample.id}`
  const logoInputRef = useRef()
  const today = new Date().toLocaleDateString('en-GB')

  const [analysis, setAnalysis] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      const defaults = {
        comments: {}, summary: '', conclusion: '', disclaimer: DEFAULT_DISCLAIMER,
        reportTitle: 'Stability Analysis Report',
        reportDate: today,
        footerLeft: `FormuLab Hub · ${sample.name}`,
        footerRight: '',
        excludedImages: [],
        companyName: '',
        companyAddress: '',
        logoData: '',
        orientation: 'portrait',
      }
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults
    } catch {
      return {
        comments: {}, summary: '', conclusion: '', disclaimer: DEFAULT_DISCLAIMER,
        reportTitle: 'Stability Analysis Report',
        reportDate: today,
        footerLeft: `FormuLab Hub · ${sample.name}`,
        footerRight: '',
        excludedImages: [],
        companyName: '',
        companyAddress: '',
        logoData: '',
        orientation: 'portrait',
      }
    }
  })

  function update(patch) {
    const next = { ...analysis, ...patch }
    setAnalysis(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch {}
  }

  function toggleImage(imgId) {
    const id = String(imgId)
    const excluded = analysis.excludedImages || []
    update({ excludedImages: excluded.includes(id) ? excluded.filter(x => x !== id) : [...excluded, id] })
  }

  function handleLogoUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => update({ logoData: ev.target.result })
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const microImages = (sample.images || []).filter(img => img.category === 'microscope')
  const imgComments = (() => {
    try { return JSON.parse(localStorage.getItem('micro_comments') || '{}') } catch { return {} }
  })()

  const visibleTPs = TIME_POINTS.filter(tp => {
    const imgs = microImages.filter(img =>
      img.time_point === tp &&
      /\.(jpe?g|png|gif|webp)$/i.test(img.original_name || img.filename || '') &&
      !(analysis.excludedImages || []).includes(String(img._id || img.id || '')))
    return imgs.length > 0
  })

  const isLandscape = analysis.orientation === 'landscape'

  return (
    <div className="space-y-4">

      {/* ── Settings card ── */}
      <div className="card p-4 space-y-3">

        {/* Row 1: Title, Date, Orientation, Download */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Report Title</label>
            <input className="input w-full text-sm" value={analysis.reportTitle}
              onChange={e => update({ reportTitle: e.target.value })} placeholder="Stability Analysis Report" />
          </div>
          <div className="w-36">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Report Date</label>
            <input className="input w-full text-sm" value={analysis.reportDate}
              onChange={e => update({ reportDate: e.target.value })} placeholder="DD/MM/YYYY" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Orientation</label>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              {[['portrait', '▯ Portrait'], ['landscape', '▭ Landscape']].map(([o, label]) => (
                <button key={o} onClick={() => update({ orientation: o })}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${analysis.orientation === o ? 'bg-white text-blue-600 shadow' : 'text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button className="btn-primary shrink-0"
            onClick={() => onGeneratePDF({ ...analysis, imgComments })} disabled={generating}>
            {generating ? '⏳ Generating...' : '⬇ Download PDF'}
          </button>
        </div>

        {/* Row 2: Logo + Company info */}
        <div className="flex flex-wrap gap-3 items-start">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Logo</label>
            <div className="w-20 h-14 border-2 border-dashed border-gray-200 rounded-lg flex items-center justify-center cursor-pointer hover:border-blue-300 transition-colors overflow-hidden bg-gray-50"
              onClick={() => logoInputRef.current?.click()}>
              {analysis.logoData
                ? <img src={analysis.logoData} className="w-full h-full object-contain p-1" alt="logo" />
                : <span className="text-gray-400 text-[10px] text-center leading-tight px-1">Click to<br/>add logo</span>}
            </div>
            <input ref={logoInputRef} type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
            {analysis.logoData && (
              <button className="text-[10px] text-red-400 hover:text-red-600 mt-1 block"
                onClick={() => update({ logoData: '' })}>Remove</button>
            )}
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Company Name</label>
            <input className="input w-full text-sm" value={analysis.companyName}
              onChange={e => update({ companyName: e.target.value })} placeholder="Your Company Name" />
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Company Address</label>
            <textarea className="input w-full text-sm resize-none" rows={2} value={analysis.companyAddress}
              onChange={e => update({ companyAddress: e.target.value })} placeholder="Street, City, State, Country..." />
          </div>
        </div>

        {/* Row 3: Footer */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Footer Left</label>
            <input className="input w-full text-sm" value={analysis.footerLeft}
              onChange={e => update({ footerLeft: e.target.value })} placeholder={`FormuLab Hub · ${sample.name}`} />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Footer Right</label>
            <input className="input w-full text-sm" value={analysis.footerRight}
              onChange={e => update({ footerRight: e.target.value })} placeholder="Blank = auto page numbers" />
          </div>
        </div>
      </div>

      {/* ── Document preview ── */}
      <div className="bg-gray-200 rounded-2xl p-4 md:p-8 overflow-x-auto">
        <div className={`mx-auto bg-white shadow-xl rounded-lg overflow-hidden text-sm ${isLandscape ? 'max-w-5xl' : 'max-w-3xl'}`}>

          {/* Header — letterhead style */}
          <div className="flex items-start gap-4 px-6 pt-5 pb-3 border-b-2 border-gray-200">
            {/* Left: Company name + address */}
            <div className="flex-1 min-w-0">
              <input
                className="text-gray-900 font-bold text-sm focus:outline-none placeholder-gray-300 w-full bg-transparent"
                value={analysis.companyName}
                onChange={e => update({ companyName: e.target.value })}
                placeholder="Company Name"
              />
              <textarea
                className="text-gray-500 text-[10px] focus:outline-none placeholder-gray-300 resize-none w-full bg-transparent mt-0.5 leading-snug"
                rows={2}
                value={analysis.companyAddress}
                onChange={e => update({ companyAddress: e.target.value })}
                placeholder="Company address..."
              />
            </div>
            {/* Center: Title + date */}
            <div className="flex-1 flex flex-col items-center min-w-0">
              <input
                className="bg-transparent text-gray-900 font-bold text-base focus:outline-none placeholder-gray-300 w-full text-center"
                value={analysis.reportTitle}
                onChange={e => update({ reportTitle: e.target.value })}
                placeholder="Stability Analysis Report"
              />
              <input
                className="bg-transparent text-gray-400 text-[10px] focus:outline-none placeholder-gray-300 mt-0.5 w-full text-center"
                value={analysis.reportDate}
                onChange={e => update({ reportDate: e.target.value })}
                placeholder="DD/MM/YYYY"
              />
            </div>
            {/* Right: Logo */}
            <div className="shrink-0 flex flex-col items-end">
              {analysis.logoData ? (
                <img src={analysis.logoData} className="max-h-16 max-w-[80px] object-contain cursor-pointer"
                  alt="logo" title="Click to change logo" onClick={() => logoInputRef.current?.click()} />
              ) : (
                <button onClick={() => logoInputRef.current?.click()}
                  className="border border-dashed border-gray-300 rounded text-gray-400 text-[10px] px-2 py-1 hover:border-blue-300 hover:text-blue-400 transition-colors leading-tight w-16 h-12 flex items-center justify-center text-center">
                  + Logo
                </button>
              )}
            </div>
          </div>

          {/* Sample info */}
          <div className="px-6 py-3 border-b border-gray-200 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-700">
            <span><span className="font-semibold">Sample:</span> {sample.name}</span>
            {sample.ref_no && <span><span className="font-semibold">Ref:</span> {sample.ref_no}</span>}
            {sample.date_started && <span><span className="font-semibold">Started:</span> {sample.date_started}</span>}
          </div>

          {/* Time point sections */}
          {visibleTPs.length === 0 && (
            <div className="px-6 py-10 text-center text-gray-400 text-sm italic">
              No microscope images uploaded yet. Upload images in the Images tab.
            </div>
          )}

          {TIME_POINTS.map(tp => {
            const tpImgs = microImages.filter(img =>
              img.time_point === tp &&
              /\.(jpe?g|png|gif|webp)$/i.test(img.original_name || img.filename || ''))
            const visibleImgs = tpImgs.filter(img =>
              !(analysis.excludedImages || []).includes(String(img._id || img.id || '')))

            if (tpImgs.length === 0) return null

            return (
              <div key={tp} className="border-b border-gray-100">
                <div className="flex items-center gap-3 px-6 py-2 bg-slate-50">
                  <div className="flex-1 bg-slate-100 px-3 py-1.5 rounded font-semibold text-blue-700 text-xs">
                    {TIME_LABELS[tp]}
                  </div>
                  {visibleImgs.length === 0 && (
                    <span className="text-xs text-red-400 italic">all images excluded — section hidden in PDF</span>
                  )}
                </div>

                {tpImgs.length > 0 && (
                  <div className="px-6 pt-3 pb-1">
                    <div className={`grid gap-3 ${isLandscape ? 'grid-cols-4' : 'grid-cols-3'}`}>
                      {tpImgs.map(img => {
                        const imgId = String(img._id || img.id || '')
                        const excluded = (analysis.excludedImages || []).includes(imgId)
                        return (
                          <div key={imgId} className="relative group rounded-lg overflow-hidden border border-gray-200">
                            <img src={img.url} alt=""
                              className={`w-full h-32 object-cover transition-opacity ${excluded ? 'opacity-25' : 'opacity-100'}`} />
                            <button
                              onClick={() => toggleImage(imgId)}
                              className={`absolute inset-0 flex items-center justify-center text-xs font-semibold transition-all
                                ${excluded
                                  ? 'bg-red-500/20 text-red-700'
                                  : 'bg-black/0 text-white opacity-0 group-hover:opacity-100 group-hover:bg-black/30'}`}
                            >
                              {excluded ? 'Excluded — click to include' : 'Click to exclude'}
                            </button>
                            {img.caption && (
                              <div className="px-1 py-1 text-center text-[10px] text-gray-500 font-medium bg-white border-t border-gray-100">
                                {img.caption}
                              </div>
                            )}
                            {imgComments[imgId] && (
                              <div className="px-2 py-1 text-[10px] text-gray-500 italic bg-white text-center">
                                {imgComments[imgId]}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="px-6 py-3">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Overall Observation</p>
                  <textarea
                    className="w-full text-sm text-gray-700 border border-dashed border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 focus:bg-blue-50/20 resize-none bg-transparent placeholder-gray-300"
                    rows={2}
                    placeholder={`Type observation for ${TIME_LABELS[tp]}...`}
                    value={analysis.comments[tp] || ''}
                    onChange={e => update({ comments: { ...analysis.comments, [tp]: e.target.value } })}
                  />
                </div>
              </div>
            )
          })}

          {/* Summary */}
          <div className="px-6 py-4 border-b border-gray-100">
            <p className="font-bold text-gray-800 mb-2">Summary</p>
            <textarea
              className="w-full text-sm text-gray-700 border border-dashed border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 focus:bg-blue-50/20 resize-none bg-transparent placeholder-gray-300"
              rows={4}
              placeholder="Summarise overall stability findings across all time points..."
              value={analysis.summary}
              onChange={e => update({ summary: e.target.value })}
            />
          </div>

          {/* Conclusion */}
          <div className="px-6 py-4 border-b border-gray-100">
            <p className="font-bold text-gray-800 mb-2">Conclusion</p>
            <textarea
              className="w-full text-sm text-gray-700 border border-dashed border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 focus:bg-blue-50/20 resize-none bg-transparent placeholder-gray-300"
              rows={4}
              placeholder="State the final conclusion and product recommendation..."
              value={analysis.conclusion}
              onChange={e => update({ conclusion: e.target.value })}
            />
          </div>

          {/* Disclaimer */}
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
            <textarea
              className="w-full text-[10px] text-gray-400 bg-transparent focus:outline-none resize-none"
              rows={3}
              value={analysis.disclaimer}
              onChange={e => update({ disclaimer: e.target.value })}
            />
          </div>

          {/* Footer preview */}
          <div className="px-6 py-2 flex justify-between text-[10px] text-gray-400 border-t border-gray-100">
            <span>{analysis.footerLeft || `FormuLab Hub · ${sample.name}`}</span>
            <span>{analysis.footerRight || 'Page 1 of N'}</span>
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS = ['Data', 'Charts', 'Images', 'Report', 'Analysis']

export default function SampleDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [sample, setSample] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('Data')
  const [entry, setEntry] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [genPDF, setGenPDF] = useState(false)
  const [genAnalysis, setGenAnalysis] = useState(false)
  const [linkedFormulation, setLinkedFormulation] = useState(null)
  const [reportOpts, setReportOpts] = useState({ title: 'Stability Test Result', footerLeft: '', footerRight: '', preparedBy: '', reviewedBy: '', excludedImages: [] })

  const load = async () => {
    try {
      const s = await getSample(id)
      setSample(s)
      setReportOpts(prev => ({ ...prev, footerLeft: prev.footerLeft || `FormuLab Hub · ${s.name}` }))
    }
    catch { navigate('/') }
    finally { setLoading(false) }
  }

  async function handleDuplicate() {
    if (!confirm(`Duplicate "${sample.name}"? A copy with no results will be created.`)) return
    const copy = await duplicateSample(sample.id)
    navigate(`/samples/${copy.id}`)
  }

  function handleExportCSV() {
    const temps = sample ? parseTempConfig(sample.temp_config) : DEFAULT_TEMPS
    const byTP = Object.fromEntries(sample.results.map(r => [r.time_point, r]))
    const sampleInfo = [
      ['Sample Name', sample.name || ''],
      ['Ref No', sample.ref_no || ''],
      ['Date Started', sample.date_started || ''],
      ['Status', STATUS_CFG[sample.status || 'active']?.label || sample.status || 'Active'],
      ['Remarks', sample.remarks || ''],
      ['pH Specification', [sample.spec_ph_min, sample.spec_ph_max].some(v => v != null && v !== '') ? `${sample.spec_ph_min ?? ''} - ${sample.spec_ph_max ?? ''}` : ''],
      ['Viscosity Specification (cP)', [sample.spec_visc_min, sample.spec_visc_max].some(v => v != null && v !== '') ? `${sample.spec_visc_min ?? ''} - ${sample.spec_visc_max ?? ''}` : ''],
    ]
    const header = ['Time Point']
    temps.forEach(t => {
      header.push(`pH ${t.value}°C`, `Viscosity ${t.value}°C`, `SG ${t.value}°C`, `Turbidity NTU ${t.value}°C`, `Spindle ${t.value}°C`, `RPM ${t.value}°C`)
    })
    header.push('Appearance', 'Color', 'Odor', 'Phase Sep', 'Microbial', 'Notes', 'Measured At')
    const rows = [['Sample Summary', ''], ...sampleInfo, [], header]
    TIME_POINTS.forEach(tp => {
      const r = byTP[tp]
      const row = [TIME_LABELS[tp]]
      temps.forEach((t, i) => {
        const suf = SUFFIXES[i]
        const isNA = (t.na_tps || []).includes(tp)
        row.push(
          isNA ? 'N/A' : (r?.[`ph_${suf}`] ?? ''),
          isNA ? 'N/A' : (r?.[`viscosity_${suf}`] ?? ''),
          isNA ? 'N/A' : (r?.[`sg_${suf}`] ?? ''),
          isNA ? 'N/A' : (r?.[`turbidity_${suf}`] ?? ''),
          isNA ? 'N/A' : (r?.[`spindle_${suf}`] ?? ''),
          isNA ? 'N/A' : (r?.[`rpm_${suf}`] ?? ''),
        )
      })
      row.push(r?.appearance || '', r?.color_obs || '', r?.odor || '', r?.phase_sep || '', r?.microbial || '', r?.notes || '', r?.measured_at || '')
      rows.push(row)
    })
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sample.name.replace(/[^a-z0-9]/gi, '_')}_stability.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleExportExcel() {
    const temps = parseTempConfig(sample.temp_config)
    const byTP = Object.fromEntries(sample.results.map(r => [r.time_point, r]))
    const dataHeader = ['Time Point']
    temps.forEach(t => {
      dataHeader.push(`pH ${t.value}°C`, `Viscosity ${t.value}°C`, `SG ${t.value}°C`, `Turbidity NTU ${t.value}°C`, `Spindle ${t.value}°C`, `RPM ${t.value}°C`)
    })
    dataHeader.push('Appearance', 'Color', 'Odor', 'Phase Sep', 'Microbial', 'Notes', 'Measured At')

    const dataRows = TIME_POINTS.map(tp => {
      const r = byTP[tp]
      const row = [TIME_LABELS[tp]]
      temps.forEach((t, i) => {
        const suf = SUFFIXES[i]
        const isNA = (t.na_tps || []).includes(tp)
        row.push(
          isNA ? 'N/A' : (r?.[`ph_${suf}`] ?? ''),
          isNA ? 'N/A' : (r?.[`viscosity_${suf}`] ?? ''),
          isNA ? 'N/A' : (r?.[`sg_${suf}`] ?? ''),
          isNA ? 'N/A' : (r?.[`turbidity_${suf}`] ?? ''),
          isNA ? 'N/A' : (r?.[`spindle_${suf}`] ?? ''),
          isNA ? 'N/A' : (r?.[`rpm_${suf}`] ?? ''),
        )
      })
      row.push(r?.appearance || '', r?.color_obs || '', r?.odor || '', r?.phase_sep || '', r?.microbial || '', r?.notes || '', r?.measured_at || '')
      return row
    })

    const summaryRows = [
      ['Field', 'Value'],
      ['Sample Name', sample.name || ''],
      ['Ref No', sample.ref_no || ''],
      ['Date Started', sample.date_started || ''],
      ['Status', STATUS_CFG[sample.status || 'active']?.label || sample.status || 'Active'],
      ['Remarks', sample.remarks || ''],
      ['pH Specification', [sample.spec_ph_min, sample.spec_ph_max].some(v => v != null && v !== '') ? `${sample.spec_ph_min ?? ''} - ${sample.spec_ph_max ?? ''}` : ''],
      ['Viscosity Specification (cP)', [sample.spec_visc_min, sample.spec_visc_max].some(v => v != null && v !== '') ? `${sample.spec_visc_min ?? ''} - ${sample.spec_visc_max ?? ''}` : ''],
      ['Temperature Conditions', temps.map(t => `${t.value}°C`).join(', ')],
    ]

    const workbook = XLSX.utils.book_new()
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows)
    const dataSheet = XLSX.utils.aoa_to_sheet([dataHeader, ...dataRows])
    summarySheet['!cols'] = [{ wch: 30 }, { wch: 60 }]
    dataSheet['!cols'] = dataHeader.map((_, i) => ({ wch: i === 0 ? 16 : 18 }))
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Sample Summary')
    XLSX.utils.book_append_sheet(workbook, dataSheet, 'Recorded Data')
    const safeName = (sample.name || 'sample').replace(/[^a-z0-9]/gi, '_')
    XLSX.writeFile(workbook, `${safeName}_stability.xlsx`)
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

  async function handleSaveCellValue(timePoint, field, value) {
    const existing = sample.results.find(r => r.time_point === timePoint)
    const numericFields = [
      'ph_25', 'ph_45', 'ph_50',
      'viscosity_25', 'viscosity_45', 'viscosity_50',
      'sg_25', 'sg_45', 'sg_50',
      'turbidity_25', 'turbidity_45', 'turbidity_50',
      'rpm_25', 'rpm_45', 'rpm_50',
    ]
    const toNum = v => (v === '' || v === null || v === undefined) ? null : Number(v)
    const parsedVal = numericFields.includes(field) ? toNum(value) : (value || null)
    const base = existing ? { ...existing } : { time_point: timePoint }
    const r = await upsertResult(id, { ...base, [field]: parsedVal })
    setSample(prev => ({
      ...prev,
      results: [...prev.results.filter(x => x.time_point !== r.time_point), r],
    }))
  }

  async function handleClearRow(resultId) {
    if (!confirm('Clear this time point data?')) return
    await deleteResult(resultId)
    setSample(prev => ({ ...prev, results: prev.results.filter(r => r.id !== resultId) }))
  }

  async function handleStatusChange(status) {
    const updated = await updateSampleStatus(id, status)
    setSample(prev => ({ ...prev, status: updated.status }))
  }

  async function handleGeneratePDF() {
    setGenPDF(true)
    try {
      await generatePDF({ ...sample, temps }, {
        title: reportOpts.title,
        footerLeft: reportOpts.footerLeft,
        footerRight: reportOpts.footerRight || null,
        preparedBy: reportOpts.preparedBy,
        reviewedBy: reportOpts.reviewedBy,
        excludedImages: reportOpts.excludedImages,
      })
    } finally { setGenPDF(false) }
  }

  function toggleReportImage(imgId) {
    const id = String(imgId)
    setReportOpts(p => ({
      ...p,
      excludedImages: p.excludedImages.includes(id)
        ? p.excludedImages.filter(x => x !== id)
        : [...p.excludedImages, id],
    }))
  }

  async function handleGenerateAnalysisPDF(analysisData) {
    setGenAnalysis(true)
    try {
      await generateAnalysisPDF({ ...sample, temps }, analysisData, {
        title: analysisData.reportTitle,
        footerLeft: analysisData.footerLeft,
        footerRight: analysisData.footerRight || null,
      })
    }
    finally { setGenAnalysis(false) }
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
              <select
                className={`text-xs font-medium px-2 py-0.5 rounded-full border-0 cursor-pointer ${STATUS_CFG[sample.status || 'active'].color}`}
                value={sample.status || 'active'}
                onChange={e => handleStatusChange(e.target.value)}
              >
                {Object.entries(STATUS_CFG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
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
                📋 {linkedFormulation.ref_no ? <span className="font-mono">{linkedFormulation.ref_no}</span> : null}{linkedFormulation.ref_no && linkedFormulation.product_name ? ' — ' : ''}{linkedFormulation.product_name || 'View Formulation'} →
              </Link>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button className="btn-secondary text-xs py-1.5" onClick={handleExportCSV} title="Download CSV">⬇ CSV</button>
            <button className="btn-secondary text-xs py-1.5" onClick={handleExportExcel} title="Download Excel workbook">⬇ Excel</button>
            <button className="btn-secondary text-xs py-1.5" onClick={handleDuplicate} title="Duplicate sample">Copy</button>
            <button className="btn-secondary text-xs py-1.5" onClick={() => setEditOpen(true)}>Edit</button>
          </div>
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
            onSaveCell={handleSaveCellValue}
            specPhMin={sample.spec_ph_min} specPhMax={sample.spec_ph_max}
            specViscMin={sample.spec_visc_min} specViscMax={sample.spec_visc_max}
          />
          <p className="text-xs text-gray-400 mt-2">
            Click any cell to edit directly · Greyed cells (—) are N/A · Click row label to open bulk entry form
          </p>
        </div>
      )}

      {tab === 'Charts' && <Charts results={sample.results} temps={temps} />}

      {tab === 'Images' && (
        <div className="space-y-8">
          <MicroscopeGallery sampleId={id} images={sample.images} onUpdate={load} />
          <div>
            <h3 className="font-semibold text-gray-800 mb-4">General Images</h3>
            <ImageGallery
              sampleId={id}
              images={sample.images.filter(img => img.category !== 'microscope')}
              onUpdate={load}
            />
          </div>
        </div>
      )}

      {tab === 'Analysis' && (
        <AnalysisReport
          sample={sample}
          onGeneratePDF={handleGenerateAnalysisPDF}
          generating={genAnalysis}
        />
      )}

      {tab === 'Report' && (
        <div>
          <div className="card p-6 mb-5">
            <h3 className="font-semibold text-gray-900 mb-4">Report Settings</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Report Title</label>
                <input className="input w-full" value={reportOpts.title}
                  onChange={e => setReportOpts(p => ({ ...p, title: e.target.value }))}
                  placeholder="Stability Test Result" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Prepared By</label>
                <input className="input w-full" value={reportOpts.preparedBy}
                  onChange={e => setReportOpts(p => ({ ...p, preparedBy: e.target.value }))}
                  placeholder="Name / position" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Footer — Left Text</label>
                <input className="input w-full" value={reportOpts.footerLeft}
                  onChange={e => setReportOpts(p => ({ ...p, footerLeft: e.target.value }))}
                  placeholder={`FormuLab Hub · ${sample.name}`} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Footer — Right Text</label>
                <input className="input w-full" value={reportOpts.footerRight}
                  onChange={e => setReportOpts(p => ({ ...p, footerRight: e.target.value }))}
                  placeholder="Blank = auto page numbers (Page 1 of 3)" />
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button className="btn-primary" onClick={handleGeneratePDF} disabled={genPDF}>
                {genPDF ? '⏳ Generating...' : '⬇ Download PDF'}
              </button>
            </div>
          </div>
          {(() => {
            const reportImgs = sample.images.filter(img => img.url && /\.(jpe?g|png|gif|webp)$/i.test(img.original_name || img.filename || ''))
            if (!reportImgs.length) return null
            return (
              <div className="card p-6 mb-5">
                <p className="font-semibold text-gray-900 mb-1">Attached Images</p>
                <p className="text-xs text-gray-400 mb-3">Toggle which images to include in the PDF report.</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {reportImgs.map(img => {
                    const imgId = String(img._id || img.id || '')
                    const excluded = reportOpts.excludedImages.includes(imgId)
                    return (
                      <div key={imgId} className={`rounded-xl border overflow-hidden transition-all cursor-pointer ${excluded ? 'opacity-40 border-gray-200' : 'border-blue-200'}`}
                        onClick={() => toggleReportImage(imgId)}>
                        <img src={img.url} alt="" className="w-full h-24 object-cover" />
                        <div className={`text-center text-xs py-1 font-medium ${excluded ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-blue-700'}`}>
                          {excluded ? 'Excluded' : 'Included'}
                        </div>
                        {img.caption && <p className="text-[10px] text-gray-500 text-center px-1 pb-1 truncate">{img.caption}</p>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

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
              onSaveCell={handleSaveCellValue}
              specPhMin={sample.spec_ph_min} specPhMax={sample.spec_ph_max}
              specViscMin={sample.spec_visc_min} specViscMax={sample.spec_visc_max}
            />
          </div>
        </div>
      )}
    </>
  )
}
