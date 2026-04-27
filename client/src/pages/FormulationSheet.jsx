import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getFormulation, updateFormulation, uploadLogo, uploadRefImage, getSamples } from '../api'
import { generateFormulationPDF } from '../pdfReport'

// ── Helpers ───────────────────────────────────────────────────────────────────

let _id = Date.now()
const uid = () => ++_id

function calcBulk(pct, bulkSize) {
  const n = parseFloat(pct)
  const b = parseFloat(bulkSize)
  if (isNaN(n) || isNaN(b) || b <= 0) return ''
  return (n / 100 * b).toFixed(2)
}

// ── Inline editable cell ──────────────────────────────────────────────────────

function EditCell({ value, onChange, type = 'text', placeholder = '', className = '', align = 'left' }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value ?? '')
  useEffect(() => { setVal(value ?? '') }, [value])

  function commit() {
    setEditing(false)
    if (String(val) !== String(value ?? '')) onChange(val)
  }

  if (editing) {
    return (
      <input
        autoFocus
        type={type}
        step={type === 'number' ? '0.01' : undefined}
        className={`w-full px-1.5 py-0.5 text-xs border border-blue-400 rounded focus:outline-none ${className}`}
        style={{ textAlign: align }}
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setVal(value ?? '') } }}
      />
    )
  }
  return (
    <div
      className={`min-h-[22px] px-1.5 py-0.5 text-xs cursor-text hover:bg-blue-50 rounded transition-colors ${className}`}
      style={{ textAlign: align }}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {val || <span className="text-gray-300 italic">{placeholder}</span>}
    </div>
  )
}

// ── Ingredients Table ─────────────────────────────────────────────────────────

function IngredientsTable({ rows, bulkSize, onChange }) {
  function update(id, field, val) {
    onChange(rows.map(r => r.id === id ? { ...r, [field]: val } : r))
  }

  function addRow() {
    const lastPart = rows.length ? rows[rows.length - 1].part : 'A'
    onChange([...rows, { id: uid(), part: lastPart, trade_name: '', inci_name: '', cas_no: '', percent: '', supplier: '', function: '', compliance: '' }])
  }

  function addRowAfter(idx) {
    const next = [...rows]
    next.splice(idx + 1, 0, { id: uid(), part: rows[idx]?.part || 'A', trade_name: '', inci_name: '', cas_no: '', percent: '', supplier: '', function: '', compliance: '' })
    onChange(next)
  }

  function removeRow(id) {
    if (rows.length <= 1) return
    onChange(rows.filter(r => r.id !== id))
  }

  function moveRow(idx, dir) {
    const next = [...rows]
    const swap = idx + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    onChange(next)
  }

  const total = rows.reduce((s, r) => s + (parseFloat(r.percent) || 0), 0)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-700 w-8">No</th>
            <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-700 w-10">Part</th>
            <th className="border border-gray-300 px-2 py-2 text-left font-semibold text-gray-700 w-32">Trade Name</th>
            <th className="border border-gray-300 px-2 py-2 text-left font-semibold text-gray-700">INCI Name</th>
            <th className="border border-gray-300 px-2 py-2 text-left font-semibold text-gray-700 w-24">CAS No.</th>
            <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-700 w-14">%</th>
            <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-700 w-20">
              Bulk ({parseFloat(bulkSize) > 0 ? `${bulkSize}g` : 'g'})
            </th>
            <th className="border border-gray-300 px-2 py-2 text-left font-semibold text-gray-700 w-28">Principal</th>
            <th className="border border-gray-300 px-2 py-2 text-left font-semibold text-gray-700">Function</th>
            <th className="border border-gray-300 px-2 py-2 text-left font-semibold text-gray-700 w-28">Compliance</th>
            <th className="border border-gray-300 px-1 py-2 w-16 text-center text-gray-400 font-normal no-print">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}>
              <td className="border border-gray-300 px-2 py-1 text-center text-gray-500">{idx + 1}</td>
              <td className="border border-gray-300 px-1 py-1">
                <EditCell value={row.part} onChange={v => update(row.id, 'part', v)} placeholder="A" align="center" />
              </td>
              <td className="border border-gray-300 px-1 py-1">
                <EditCell value={row.trade_name} onChange={v => update(row.id, 'trade_name', v)} placeholder="Trade name..." />
              </td>
              <td className="border border-gray-300 px-1 py-1">
                <EditCell value={row.inci_name} onChange={v => update(row.id, 'inci_name', v)} placeholder="INCI name..." />
              </td>
              <td className="border border-gray-300 px-1 py-1">
                <EditCell value={row.cas_no} onChange={v => update(row.id, 'cas_no', v)} placeholder="e.g. 7732-18-5" />
              </td>
              <td className="border border-gray-300 px-1 py-1">
                <EditCell value={row.percent} onChange={v => update(row.id, 'percent', v)} type="number" placeholder="0.00" align="right" />
              </td>
              <td className="border border-gray-300 px-2 py-1 text-right text-gray-600 bg-blue-50/30">
                {calcBulk(row.percent, bulkSize) || '—'}
              </td>
              <td className="border border-gray-300 px-1 py-1">
                <EditCell value={row.supplier} onChange={v => update(row.id, 'supplier', v)} placeholder="Supplier..." />
              </td>
              <td className="border border-gray-300 px-1 py-1">
                <EditCell value={row.function} onChange={v => update(row.id, 'function', v)} placeholder="Function..." />
              </td>
              <td className="border border-gray-300 px-1 py-1">
                <EditCell value={row.compliance} onChange={v => update(row.id, 'compliance', v)} placeholder="e.g. EU, ASEAN..." />
              </td>
              <td className="border border-gray-300 px-1 py-1 no-print">
                <div className="flex items-center justify-center gap-0.5">
                  <button onClick={() => moveRow(idx, -1)} className="text-gray-300 hover:text-gray-600 px-0.5" title="Move up">↑</button>
                  <button onClick={() => moveRow(idx, 1)} className="text-gray-300 hover:text-gray-600 px-0.5" title="Move down">↓</button>
                  <button onClick={() => addRowAfter(idx)} className="text-blue-300 hover:text-blue-600 px-0.5" title="Insert row below">+</button>
                  <button onClick={() => removeRow(row.id)} className="text-red-300 hover:text-red-600 px-0.5" title="Delete row">✕</button>
                </div>
              </td>
            </tr>
          ))}
          {/* Total row */}
          <tr className="bg-gray-100 font-semibold">
            <td colSpan={5} className="border border-gray-300 px-2 py-1.5 text-right text-xs text-gray-600">Total</td>
            <td className={`border border-gray-300 px-2 py-1.5 text-right text-xs ${Math.abs(total - 100) < 0.01 ? 'text-green-700' : total > 100 ? 'text-red-600' : 'text-amber-600'}`}>
              {total.toFixed(2)}%
            </td>
            <td className="border border-gray-300 px-2 py-1.5 text-right text-xs text-gray-600">
              {parseFloat(bulkSize) > 0 ? `${(total / 100 * parseFloat(bulkSize)).toFixed(2)}g` : '—'}
            </td>
            <td colSpan={4} className="border border-gray-300" />
          </tr>
        </tbody>
      </table>
      <button className="btn-secondary text-xs mt-2 no-print" onClick={addRow}>+ Add Ingredient</button>
      {Math.abs(total - 100) > 0.01 && (
        <p className={`text-xs mt-1 ${total > 100 ? 'text-red-500' : 'text-amber-500'}`}>
          ⚠ Total is {total.toFixed(2)}% — {total > 100 ? 'exceeds' : 'below'} 100%
        </p>
      )}
    </div>
  )
}

// ── Procedure Editor ──────────────────────────────────────────────────────────

function ProcedureEditor({ steps, onChange }) {
  function update(id, val) { onChange(steps.map(s => s.id === id ? { ...s, text: val } : s)) }
  function add() { onChange([...steps, { id: uid(), text: '' }]) }
  function remove(id) { if (steps.length > 1) onChange(steps.filter(s => s.id !== id)) }
  function move(idx, dir) {
    const next = [...steps]; const swap = idx + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {steps.map((s, idx) => (
        <div key={s.id} className="flex items-start gap-2 group">
          <span className="text-xs font-semibold text-gray-500 mt-2 w-5 shrink-0">{idx + 1}</span>
          <textarea
            className="input flex-1 resize-none text-sm leading-relaxed"
            rows={2}
            value={s.text}
            onChange={e => update(s.id, e.target.value)}
            placeholder={`Step ${idx + 1}...`}
          />
          <div className="flex flex-col gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity no-print">
            <button onClick={() => move(idx, -1)} className="text-gray-300 hover:text-gray-600 text-xs">↑</button>
            <button onClick={() => move(idx, 1)} className="text-gray-300 hover:text-gray-600 text-xs">↓</button>
            <button onClick={() => remove(s.id)} className="text-red-300 hover:text-red-500 text-xs">✕</button>
          </div>
        </div>
      ))}
      <button className="btn-secondary text-xs no-print" onClick={add}>+ Add Step</button>
    </div>
  )
}

// ── Specifications Editor ─────────────────────────────────────────────────────

function SpecsEditor({ specs, onChange }) {
  function update(id, field, val) { onChange(specs.map(s => s.id === id ? { ...s, [field]: val } : s)) }
  function add() { onChange([...specs, { id: uid(), property: '', value: '' }]) }
  function remove(id) { onChange(specs.filter(s => s.id !== id)) }

  return (
    <div className="space-y-2">
      {specs.map(s => (
        <div key={s.id} className="flex items-center gap-2 group">
          <input className="input w-48 text-sm" value={s.property}
            onChange={e => update(s.id, 'property', e.target.value)} placeholder="Property name..." />
          <input className="input flex-1 text-sm" value={s.value}
            onChange={e => update(s.id, 'value', e.target.value)} placeholder="Value..." />
          <button onClick={() => remove(s.id)}
            className="text-red-300 hover:text-red-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity no-print">✕</button>
        </div>
      ))}
      <button className="btn-secondary text-xs no-print" onClick={add}>+ Add Property</button>
    </div>
  )
}

// ── Image Uploader ────────────────────────────────────────────────────────────

function ImageUploader({ label, filename, onUpload }) {
  const ref = useRef()
  const [uploading, setUploading] = useState(false)
  async function handle(e) {
    const f = e.target.files[0]; if (!f) return
    setUploading(true)
    try { await onUpload(f) } finally { setUploading(false); e.target.value = '' }
  }
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <div className="flex items-center gap-3">
        {filename && /\.(jpe?g|png|gif|webp)$/i.test(filename) && (
          <img src={`/uploads/${filename}`} alt={label} className="h-16 object-contain rounded border border-gray-200 bg-white p-1" />
        )}
        <button className="btn-secondary text-xs" onClick={() => ref.current.click()} disabled={uploading}>
          {uploading ? 'Uploading...' : filename ? 'Replace' : `Upload ${label}`}
        </button>
        <input ref={ref} type="file" className="hidden" accept="image/*" onChange={handle} />
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FormulationSheet() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [form, setForm] = useState(null)
  const [samples, setSamples] = useState([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [genPDF, setGenPDF] = useState(false)
  const saveTimer = useRef(null)

  useEffect(() => {
    getFormulation(id).then(setForm).catch(() => navigate('/formulations'))
    getSamples().then(setSamples).catch(() => {})
  }, [id])

  const autoSave = useCallback((data) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      try { await updateFormulation(id, data); setSaved(true); setTimeout(() => setSaved(false), 2000) }
      finally { setSaving(false) }
    }, 800)
  }, [id])

  function update(field, val) {
    const next = { ...form, [field]: val }
    setForm(next)
    autoSave(next)
  }

  async function handleLogoUpload(file) {
    const r = await uploadLogo(id, file)
    const next = { ...form, logo_filename: r.filename }
    setForm(next)
  }

  async function handleRefImageUpload(file) {
    const r = await uploadRefImage(id, file)
    const next = { ...form, ref_image_filename: r.filename }
    setForm(next)
  }

  async function handlePDF() {
    setGenPDF(true)
    try { await generateFormulationPDF(form) } finally { setGenPDF(false) }
  }

  if (!form) return <div className="text-center py-20 text-gray-400">Loading...</div>

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between no-print">
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs" onClick={() => navigate('/formulations')}>← Back</button>
          <span className="text-xs text-gray-400">{saving ? 'Saving...' : saved ? '✓ Saved' : 'Auto-saves'}</span>
        </div>
        <button className="btn-primary" onClick={handlePDF} disabled={genPDF}>
          {genPDF ? '⏳ Generating...' : '⬇ Download PDF'}
        </button>
      </div>

      {/* ── Letterhead ───────────────────────────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-6 mb-5">
          {/* Company info */}
          <div className="flex-1 space-y-1">
            <input className="text-lg font-bold text-gray-900 border-0 border-b border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none w-full bg-transparent"
              value={form.company_name} onChange={e => update('company_name', e.target.value)} placeholder="Company Name" />
            <textarea className="text-xs text-gray-600 border-0 border-b border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none w-full bg-transparent resize-none leading-relaxed"
              rows={3} value={form.company_address} onChange={e => update('company_address', e.target.value)} placeholder="Address..." />
            <div className="flex gap-4 text-xs text-gray-600">
              <div className="flex items-center gap-1">
                <span className="text-gray-400">Tel:</span>
                <input className="border-0 border-b border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none bg-transparent w-32"
                  value={form.company_tel} onChange={e => update('company_tel', e.target.value)} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-400">Fax:</span>
                <input className="border-0 border-b border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none bg-transparent w-32"
                  value={form.company_fax} onChange={e => update('company_fax', e.target.value)} />
              </div>
            </div>
          </div>
          {/* Logo */}
          <div className="shrink-0">
            <ImageUploader label="Logo" filename={form.logo_filename} onUpload={handleLogoUpload} />
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4 grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-2">
            <div>
              <label className="label">Product Name</label>
              <input className="input font-semibold" value={form.product_name}
                onChange={e => update('product_name', e.target.value)} placeholder="Product name..." />
            </div>
            <div>
              <label className="label">Ref No</label>
              <input className="input" value={form.ref_no}
                onChange={e => update('ref_no', e.target.value)} placeholder="TN00000SC000/1" />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea className="input resize-none" rows={2} value={form.description}
                onChange={e => update('description', e.target.value)} placeholder="Product description..." />
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="label">Batch / Bulk Size (g)</label>
              <input className="input" type="number" value={form.bulk_size}
                onChange={e => update('bulk_size', e.target.value)} placeholder="e.g. 1000" />
              <p className="text-xs text-gray-400 mt-1">Used to calculate per-ingredient weight</p>
            </div>
            <div>
              <label className="label">Linked Stability Test</label>
              <select className="input" value={form.linked_sample_id || ''}
                onChange={e => update('linked_sample_id', e.target.value ? Number(e.target.value) : null)}>
                <option value="">— None —</option>
                {samples.map(s => (
                  <option key={s.id} value={s.id}>{s.name}{s.ref_no ? ` (${s.ref_no})` : ''}</option>
                ))}
              </select>
              {form.linked_sample_id && (
                <Link to={`/samples/${form.linked_sample_id}`}
                  className="text-xs text-blue-600 hover:underline mt-1 inline-block">
                  View stability test →
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Ingredients Table ─────────────────────────────────────────────── */}
      <div className="card p-6">
        <h3 className="font-semibold text-gray-900 mb-3">Formulation Ingredients</h3>
        <IngredientsTable
          rows={form.ingredients || []}
          bulkSize={form.bulk_size}
          onChange={rows => update('ingredients', rows)}
        />
      </div>

      {/* ── Procedure ────────────────────────────────────────────────────── */}
      <div className="card p-6">
        <h3 className="font-semibold text-gray-900 mb-3">Procedure</h3>
        <ProcedureEditor
          steps={form.procedure || []}
          onChange={steps => update('procedure', steps)}
        />
      </div>

      {/* ── Product Specs + Ref Image ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-6">
          <h3 className="font-semibold text-gray-900 mb-3">Product Specifications</h3>
          <SpecsEditor
            specs={form.specifications || []}
            onChange={specs => update('specifications', specs)}
          />
          <div className="mt-4">
            <label className="label">Remarks</label>
            <textarea className="input resize-none text-sm" rows={2} value={form.remarks}
              onChange={e => update('remarks', e.target.value)} placeholder="Additional remarks..." />
          </div>
        </div>

        <div className="card p-6">
          <h3 className="font-semibold text-gray-900 mb-3">Reference Image</h3>
          <ImageUploader label="Product Image" filename={form.ref_image_filename} onUpload={handleRefImageUpload} />
          {form.ref_image_filename && /\.(jpe?g|png|gif|webp)$/i.test(form.ref_image_filename) && (
            <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden bg-gray-50 flex items-center justify-center" style={{ minHeight: 160 }}>
              <img src={`/uploads/${form.ref_image_filename}`} alt="Reference"
                className="max-h-48 object-contain" />
            </div>
          )}
        </div>
      </div>

      {/* ── Disclaimer ───────────────────────────────────────────────────── */}
      <div className="card p-6 bg-gray-50">
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Disclaimer</h3>
        <textarea className="input resize-none text-xs text-gray-500 bg-gray-50 leading-relaxed" rows={4}
          value={form.disclaimer} onChange={e => update('disclaimer', e.target.value)} />
      </div>
    </div>
  )
}
