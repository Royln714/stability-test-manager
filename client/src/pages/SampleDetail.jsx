import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSample, updateSample, upsertResult, deleteResult, uploadImage, updateImageCaption, deleteImage } from '../api'
import DataEntryModal from '../components/DataEntryModal'
import Charts from '../components/Charts'
import { generatePDF } from '../pdfReport'

// ── Constants ────────────────────────────────────────────────────────────────

const TIME_POINTS = ['Initial', '2_weeks', '1_month', '2_months', '3_months']
const TIME_LABELS = { Initial: 'Initial', '2_weeks': '2 Weeks', '1_month': '1 Month', '2_months': '2 Months', '3_months': '3 Months' }
const NA_CELLS = { 45: ['Initial'], 50: ['Initial', '2_weeks'] }
const isNA = (temp, tp) => (NA_CELLS[temp] || []).includes(tp)

const fmt = v => (v === null || v === undefined || v === '') ? null : Number(v).toFixed(2)

// ── Results Table ─────────────────────────────────────────────────────────────

function ResultsTable({ results, onCellClick, onClearRow }) {
  const byTP = Object.fromEntries(results.map(r => [r.time_point, r]))

  function Cell({ tp, field, temp }) {
    if (isNA(temp, tp)) return <td className="na-cell border border-gray-200 px-2 py-2 text-xs">—</td>
    const row = byTP[tp]
    const val = row ? row[field] : null
    const display = fmt(val)
    return (
      <td
        className={`border border-gray-200 px-2 py-2 text-xs text-center cursor-pointer transition-colors ${display !== null ? 'hover:bg-blue-50 font-medium text-gray-800' : 'hover:bg-blue-50 text-gray-300'}`}
        onClick={() => onCellClick(tp)}
        title="Click to edit"
      >
        {display !== null ? display : <span className="text-gray-300">+</span>}
      </td>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="border border-gray-200 px-3 py-2.5 text-left font-semibold text-gray-700 w-24">Duration</th>
            <th colSpan={2} className="border border-gray-200 px-2 py-2.5 text-center font-semibold text-gray-700 bg-blue-50">25°C</th>
            <th colSpan={2} className="border border-gray-200 px-2 py-2.5 text-center font-semibold text-gray-700 bg-amber-50">45°C</th>
            <th colSpan={2} className="border border-gray-200 px-2 py-2.5 text-center font-semibold text-gray-700 bg-red-50">50°C</th>
            <th className="border border-gray-200 px-2 py-2.5 text-center font-semibold text-gray-700">Notes</th>
            <th className="border border-gray-200 px-2 py-2.5 text-center font-semibold text-gray-700 w-10"></th>
          </tr>
          <tr className="bg-gray-50 text-gray-500">
            <th className="border border-gray-200 px-3 py-1.5"></th>
            <th className="border border-gray-200 px-2 py-1.5 text-center font-medium bg-blue-50/50">pH</th>
            <th className="border border-gray-200 px-2 py-1.5 text-center font-medium bg-blue-50/50">Viscosity</th>
            <th className="border border-gray-200 px-2 py-1.5 text-center font-medium bg-amber-50/50">pH</th>
            <th className="border border-gray-200 px-2 py-1.5 text-center font-medium bg-amber-50/50">Viscosity</th>
            <th className="border border-gray-200 px-2 py-1.5 text-center font-medium bg-red-50/50">pH</th>
            <th className="border border-gray-200 px-2 py-1.5 text-center font-medium bg-red-50/50">Viscosity</th>
            <th className="border border-gray-200 px-2 py-1.5"></th>
            <th className="border border-gray-200 px-2 py-1.5"></th>
          </tr>
        </thead>
        <tbody>
          {TIME_POINTS.map((tp, i) => {
            const row = byTP[tp]
            const hasData = !!row
            return (
              <tr key={tp} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                <td
                  className="border border-gray-200 px-3 py-2 font-medium text-gray-700 cursor-pointer hover:bg-blue-50 transition-colors"
                  onClick={() => onCellClick(tp)}
                >
                  {TIME_LABELS[tp]}
                  {hasData && <span className="ml-1.5 text-green-500 text-xs">●</span>}
                </td>
                <Cell tp={tp} field="ph_25" temp={25} />
                <Cell tp={tp} field="viscosity_25" temp={25} />
                <Cell tp={tp} field="ph_45" temp={45} />
                <Cell tp={tp} field="viscosity_45" temp={45} />
                <Cell tp={tp} field="ph_50" temp={50} />
                <Cell tp={tp} field="viscosity_50" temp={50} />
                <td className="border border-gray-200 px-2 py-2 text-xs text-gray-500 max-w-[120px] truncate" title={row?.notes}>
                  {row?.notes || ''}
                </td>
                <td className="border border-gray-200 px-2 py-2 text-center">
                  {hasData && (
                    <button onClick={() => onClearRow(row.id)} className="text-gray-300 hover:text-red-500 text-sm transition-colors" title="Clear this row">✕</button>
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
    try {
      for (const f of files) { await uploadImage(sampleId, f) }
      onUpdate()
    } finally { setUploading(false); e.target.value = '' }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this image?')) return
    await deleteImage(id)
    onUpdate()
  }

  async function saveCaption(img) {
    await updateImageCaption(img.id, editCaption[img.id] ?? img.caption)
    setEditCaption(prev => { const n = { ...prev }; delete n[img.id]; return n })
    onUpdate()
  }

  return (
    <div>
      {/* Upload zone */}
      <div
        className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-all mb-5"
        onClick={() => fileRef.current.click()}
      >
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
              <div
                className="aspect-square bg-gray-100 flex items-center justify-center cursor-pointer"
                onClick={() => setLightbox(img)}
              >
                {/\.(jpe?g|png|gif|webp)$/i.test(img.filename) ? (
                  <img src={`/uploads/${img.filename}`} alt={img.caption || img.original_name} className="w-full h-full object-cover" />
                ) : (
                  <div className="text-3xl">📄</div>
                )}
              </div>
              <div className="p-2">
                <input
                  className="w-full text-xs border-0 bg-transparent text-gray-500 focus:outline-none focus:text-gray-800"
                  placeholder="Add caption..."
                  value={editCaption[img.id] !== undefined ? editCaption[img.id] : (img.caption || '')}
                  onChange={e => setEditCaption(prev => ({ ...prev, [img.id]: e.target.value }))}
                  onBlur={() => editCaption[img.id] !== undefined && saveCaption(img)}
                  onKeyDown={e => e.key === 'Enter' && saveCaption(img)}
                />
                <p className="text-xs text-gray-300 truncate">{img.original_name}</p>
              </div>
              <button
                onClick={() => handleDelete(img.id)}
                className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <div className="relative max-w-4xl max-h-full">
            <img src={`/uploads/${lightbox.filename}`} alt={lightbox.caption} className="max-w-full max-h-screen object-contain rounded-lg" />
            {lightbox.caption && <p className="text-center text-white text-sm mt-2">{lightbox.caption}</p>}
            <button className="absolute -top-3 -right-3 w-8 h-8 bg-white text-gray-800 rounded-full font-bold text-sm" onClick={() => setLightbox(null)}>✕</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Edit Sample Modal ─────────────────────────────────────────────────────────

function EditSampleModal({ sample, onClose, onSave }) {
  const [form, setForm] = useState({ name: sample.name, ref_no: sample.ref_no || '', date_started: sample.date_started || '', remarks: sample.remarks || '' })
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try { onSave(await updateSample(sample.id, form)); onClose() }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100">
          <h2 className="text-base font-semibold">Edit Sample</h2>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <div><label className="label">Sample Name *</label><input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Ref No</label><input className="input" value={form.ref_no} onChange={e => setForm(f => ({ ...f, ref_no: e.target.value }))} /></div>
            <div><label className="label">Date Started</label><input type="date" className="input" value={form.date_started} onChange={e => setForm(f => ({ ...f, date_started: e.target.value }))} /></div>
          </div>
          <div><label className="label">Remarks</label><textarea className="input resize-none" rows={2} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} /></div>
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
  const [entry, setEntry] = useState(null)   // time_point being edited
  const [editOpen, setEditOpen] = useState(false)
  const [genPDF, setGenPDF] = useState(false)

  const load = async () => {
    try { setSample(await getSample(id)) }
    catch { navigate('/') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [id])

  async function handleSaveResult(data) {
    const r = await upsertResult(id, data)
    setSample(prev => {
      const results = prev.results.filter(x => x.time_point !== r.time_point)
      return { ...prev, results: [...results, r] }
    })
  }

  async function handleClearRow(resultId) {
    if (!confirm('Clear this time point data?')) return
    await deleteResult(resultId)
    setSample(prev => ({ ...prev, results: prev.results.filter(r => r.id !== resultId) }))
  }

  async function handleGeneratePDF() {
    setGenPDF(true)
    try { await generatePDF(sample) }
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
          sampleId={id}
          timePoint={entry}
          existing={sample.results.find(r => r.time_point === entry)}
          onSave={handleSaveResult}
          onClose={() => setEntry(null)}
        />
      )}
      {editOpen && (
        <EditSampleModal
          sample={sample}
          onClose={() => setEditOpen(false)}
          onSave={s => setSample(prev => ({ ...prev, ...s }))}
        />
      )}

      {/* Sample header */}
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
              {sample.date_started && <span>📅 Started: {sample.date_started}</span>}
              <span>✅ {completed}/5 time points</span>
              <span>📸 {sample.images.length} images</span>
            </div>
            {sample.remarks && <p className="mt-1 text-sm text-gray-500 italic">"{sample.remarks}"</p>}
          </div>
          <div className="flex gap-2 shrink-0">
            <button className="btn-secondary text-xs py-1.5" onClick={() => setEditOpen(true)}>Edit</button>
          </div>
        </div>

        {/* progress bar */}
        <div className="mt-3">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit no-print">
        {TABS.map(t => (
          <button
            key={t}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            onClick={() => setTab(t)}
          >{t}</button>
        ))}
      </div>

      {/* Data tab */}
      {tab === 'Data' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500">Click any cell or row label to enter measurements</p>
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
            onCellClick={tp => setEntry(tp)}
            onClearRow={handleClearRow}
          />
          <p className="text-xs text-gray-400 mt-2">
            N/A cells: 45°C measurement starts at 2 Weeks · 50°C measurement starts at 1 Month
          </p>
        </div>
      )}

      {/* Charts tab */}
      {tab === 'Charts' && <Charts results={sample.results} />}

      {/* Images tab */}
      {tab === 'Images' && (
        <ImageGallery
          sampleId={id}
          images={sample.images}
          onUpdate={load}
        />
      )}

      {/* Report tab */}
      {tab === 'Report' && (
        <div>
          <div className="card p-6 mb-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">Generate Report</h3>
                <p className="text-sm text-gray-500 mt-0.5">Export a PDF report matching the stability test template</p>
              </div>
              <button className="btn-primary" onClick={handleGeneratePDF} disabled={genPDF}>
                {genPDF ? '⏳ Generating...' : '⬇ Download PDF'}
              </button>
            </div>
          </div>

          {/* Report preview table */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Stability Test Result</h2>
                <p className="text-xs text-gray-400 mt-0.5">Preview — matches downloadable PDF</p>
              </div>
              <div className="text-right text-xs text-gray-500">
                <p className="font-semibold">{sample.name}</p>
                <p>{sample.ref_no && `Ref: ${sample.ref_no}`}</p>
                <p>{sample.date_started && `Started: ${sample.date_started}`}</p>
              </div>
            </div>
            <ResultsTable
              results={sample.results}
              onCellClick={tp => { setTab('Data'); setEntry(tp) }}
              onClearRow={handleClearRow}
            />
            {sample.images.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Attached Images</p>
                <div className="grid grid-cols-4 gap-2">
                  {sample.images.filter(img => /\.(jpe?g|png|gif|webp)$/i.test(img.filename)).map(img => (
                    <div key={img.id} className="aspect-square bg-gray-100 rounded-lg overflow-hidden">
                      <img src={`/uploads/${img.filename}`} alt={img.caption} className="w-full h-full object-cover" />
                      {img.caption && <p className="text-xs text-center text-gray-500 p-1 truncate">{img.caption}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
