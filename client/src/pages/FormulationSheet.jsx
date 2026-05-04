import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getFormulation, updateFormulation, createFormulation, uploadLogo, uploadRefImage, getSamples } from '../api'
import { generateFormulationPDF } from '../pdfReport'
import { searchIngredients } from '../ingredientDB'
import * as XLSX from 'xlsx'

let _id = Date.now()
const uid = () => ++_id

const STATUS_OPTIONS = ['Lab Trial', 'Completed', 'Improvement', 'Benchmark']
const STATUS_COLORS = {
  'Lab Trial':   'bg-blue-50 text-blue-700 border-blue-200',
  'Completed':   'bg-green-50 text-green-700 border-green-200',
  'Improvement': 'bg-amber-50 text-amber-700 border-amber-200',
  'Benchmark':   'bg-purple-50 text-purple-700 border-purple-200',
}

const COL_DEFS = {
  part:        { label: 'Part',        w: 'w-10' },
  trade_name:  { label: 'Trade Name',  w: 'w-32' },
  description: { label: 'Description', w: 'w-32' },
  inci_name:   { label: 'INCI Name',   w: '' },
  cas_no:      { label: 'CAS No.',     w: 'w-24' },
  percent:     { label: '%',           w: 'w-14' },
  bulk:        { label: 'Bulk',        w: 'w-20' },
  supplier:    { label: 'Principal',   w: 'w-28' },
  function:    { label: 'Function',    w: '' },
  compliance:  { label: 'Compliance',  w: 'w-28' },
}
const DEFAULT_COL_ORDER = ['part','trade_name','description','inci_name','cas_no','percent','bulk','supplier','function','compliance']

function calcBulk(pct, bulkSize) {
  const n = parseFloat(pct), b = parseFloat(bulkSize)
  if (isNaN(n) || isNaN(b) || b <= 0) return ''
  return (n / 100 * b).toFixed(2)
}

function getEffRows(rows, qsEnabled) {
  if (!qsEnabled || rows.length === 0) return rows
  const restTotal = rows.slice(1).reduce((s, r) => s + (parseFloat(r.percent) || 0), 0)
  const qsPct = Math.max(0, 100 - restTotal)
  return [{ ...rows[0], percent: qsPct.toFixed(4) }, ...rows.slice(1)]
}

function mergeColOrder(saved) {
  if (!saved || saved.length === 0) return DEFAULT_COL_ORDER
  const filtered = saved.filter(k => DEFAULT_COL_ORDER.includes(k))
  const missing = DEFAULT_COL_ORDER.filter(k => !filtered.includes(k))
  return [...filtered, ...missing]
}

// ── EditCell ──────────────────────────────────────────────────────────────────

function EditCell({ value, onChange, type = 'text', placeholder = '', align = 'left' }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value ?? '')
  useEffect(() => { setVal(value ?? '') }, [value])
  function commit() { setEditing(false); if (String(val) !== String(value ?? '')) onChange(val) }
  if (editing) return (
    <input autoFocus type={type} step={type === 'number' ? '0.01' : undefined}
      className="w-full px-1.5 py-0.5 text-xs border border-blue-400 rounded focus:outline-none"
      style={{ textAlign: align }} value={val}
      onChange={e => setVal(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setVal(value ?? '') } }}
    />
  )
  return (
    <div className="min-h-[22px] px-1.5 py-0.5 text-xs cursor-text hover:bg-blue-50 rounded transition-colors"
      style={{ textAlign: align }} onClick={() => setEditing(true)} title="Click to edit">
      {val || <span className="text-gray-300 italic">{placeholder}</span>}
    </div>
  )
}

// ── AutocompleteCell ──────────────────────────────────────────────────────────

function AutocompleteCell({ row, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(row.trade_name ?? '')
  const [suggestions, setSuggestions] = useState([])
  const wrapperRef = useRef(null)
  useEffect(() => { setVal(row.trade_name ?? '') }, [row.trade_name])

  function handleInput(e) {
    const v = e.target.value; setVal(v)
    setSuggestions(v.trim().length >= 2 ? searchIngredients(v) : [])
  }
  function commit() { setEditing(false); setSuggestions([]); if (val !== (row.trade_name ?? '')) onUpdate({ trade_name: val }) }
  function selectSuggestion(item) {
    const updates = { trade_name: item.trade_name, inci_name: item.inci || '', cas_no: item.cas || '' }
    if (!row.supplier && item.supplier) updates.supplier = item.supplier
    if (!row.function && item.function) updates.function = item.function
    setVal(item.trade_name); setSuggestions([]); setEditing(false); onUpdate(updates)
  }
  useEffect(() => {
    function onOut(e) { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) { setEditing(false); setSuggestions([]) } }
    if (editing) document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [editing])

  if (!editing) return (
    <div className="min-h-[22px] px-1.5 py-0.5 text-xs cursor-text hover:bg-blue-50 rounded transition-colors"
      onClick={() => setEditing(true)} title="Click to edit">
      {val || <span className="text-gray-300 italic">Trade name...</span>}
    </div>
  )
  return (
    <div ref={wrapperRef} className="relative">
      <input autoFocus className="w-full px-1.5 py-0.5 text-xs border border-blue-400 rounded focus:outline-none"
        value={val} onChange={handleInput}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setSuggestions([]); setVal(row.trade_name ?? '') } }}
      />
      {suggestions.length > 0 && (
        <div className="absolute left-0 top-full mt-0.5 z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[280px] max-h-48 overflow-y-auto">
          {suggestions.map((item, i) => (
            <button key={i} type="button" className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b border-gray-100 last:border-0"
              onMouseDown={e => { e.preventDefault(); selectSuggestion(item) }}>
              <div className="font-medium text-gray-800">{item.trade_name}</div>
              <div className="text-gray-400">{item.inci}{item.cas ? ` · ${item.cas}` : ''}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── IngredientsTable ──────────────────────────────────────────────────────────

function IngredientsTable({ rows, bulkSize, qsEnabled, onQsToggle, colOrder, onColOrderChange, onChange }) {
  const dragRowRef = useRef(null)
  const dragColRef = useRef(null)
  const [dragOverRow, setDragOverRow] = useState(null)
  const [dragOverCol, setDragOverCol] = useState(null)

  const effRows = getEffRows(rows, qsEnabled)
  const total = effRows.reduce((s, r) => s + (parseFloat(r.percent) || 0), 0)

  const blankRow = (part = 'A') => ({ id: uid(), part, trade_name: '', description: '', inci_name: '', cas_no: '', percent: '', supplier: '', function: '', compliance: '' })

  function upd(id, field, val) { onChange(rows.map(r => r.id === id ? { ...r, [field]: val } : r)) }
  function addRow() { onChange([...rows, blankRow(rows.length ? rows[rows.length - 1].part : 'A')]) }
  function addRowAfter(idx) { const n = [...rows]; n.splice(idx + 1, 0, blankRow(rows[idx]?.part || 'A')); onChange(n) }
  function removeRow(id) { if (rows.length <= 1) return; onChange(rows.filter(r => r.id !== id)) }

  function onRowDragStart(e, idx) { dragRowRef.current = idx; e.dataTransfer.effectAllowed = 'move' }
  function onRowDragOver(e, idx) { e.preventDefault(); setDragOverRow(idx) }
  function onRowDrop(e, idx) {
    e.preventDefault(); setDragOverRow(null)
    const from = dragRowRef.current; if (from === null || from === idx) return
    const n = [...rows]; const [m] = n.splice(from, 1); n.splice(idx, 0, m); onChange(n); dragRowRef.current = null
  }
  function onRowDragEnd() { dragRowRef.current = null; setDragOverRow(null) }

  function onColDragStart(e, key) { dragColRef.current = key; e.dataTransfer.effectAllowed = 'move' }
  function onColDragOver(e, key) { e.preventDefault(); setDragOverCol(key) }
  function onColDrop(e, key) {
    e.preventDefault(); setDragOverCol(null)
    const from = dragColRef.current; if (!from || from === key) return
    const n = [...colOrder]; const fi = n.indexOf(from), ti = n.indexOf(key)
    if (fi < 0 || ti < 0) return; n.splice(fi, 1); n.splice(ti, 0, from); onColOrderChange(n); dragColRef.current = null
  }
  function onColDragEnd() { dragColRef.current = null; setDragOverCol(null) }

  function cellFor(key, row, isQsRow) {
    switch (key) {
      case 'part':        return <EditCell value={row.part || ''} onChange={v => upd(row.id, 'part', v)} placeholder="A" align="center" />
      case 'trade_name':  return <AutocompleteCell row={row} onUpdate={u => onChange(rows.map(r => r.id === row.id ? { ...r, ...u } : r))} />
      case 'description': return <EditCell value={row.description || ''} onChange={v => upd(row.id, 'description', v)} placeholder="Description..." />
      case 'inci_name':   return <EditCell value={row.inci_name || ''} onChange={v => upd(row.id, 'inci_name', v)} placeholder="INCI name..." />
      case 'cas_no':      return <EditCell value={row.cas_no || ''} onChange={v => upd(row.id, 'cas_no', v)} placeholder="e.g. 7732-18-5" />
      case 'percent':
        if (isQsRow) return (
          <div className="min-h-[22px] px-1.5 py-0.5 text-xs flex items-center justify-end gap-1">
            <span className="text-blue-700 font-semibold">{Number(row.percent).toFixed(4)}</span>
            <span className="text-[10px] bg-blue-100 text-blue-500 px-1 py-0.5 rounded leading-none">QS</span>
          </div>
        )
        return <EditCell value={row.percent || ''} onChange={v => upd(row.id, 'percent', v)} type="number" placeholder="0.00" align="right" />
      case 'bulk':
        return <div className="min-h-[22px] px-2 py-0.5 text-xs text-right text-gray-600">{calcBulk(row.percent, bulkSize) || '—'}</div>
      case 'supplier':    return <EditCell value={row.supplier || ''} onChange={v => upd(row.id, 'supplier', v)} placeholder="Supplier..." />
      case 'function':    return <EditCell value={row.function || ''} onChange={v => upd(row.id, 'function', v)} placeholder="Function..." />
      case 'compliance':  return <EditCell value={row.compliance || ''} onChange={v => upd(row.id, 'compliance', v)} placeholder="e.g. EU, ASEAN..." />
      default: return null
    }
  }

  return (
    <div className="overflow-x-auto">
      <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none text-gray-600 mb-2 no-print">
        <input type="checkbox" checked={!!qsEnabled} onChange={e => onQsToggle(e.target.checked)} className="rounded" />
        Auto QS for ingredient #1 (balance to 100%)
      </label>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="border border-gray-200 px-1 py-2 w-5 no-print" title="Drag row to reorder" />
            <th className="border border-gray-200 px-2 py-2 text-center font-semibold text-gray-700 w-8">No</th>
            {colOrder.map(key => (
              <th key={key}
                className={`border border-gray-200 px-2 py-2 text-center font-semibold text-gray-700 cursor-grab select-none ${COL_DEFS[key]?.w || ''} ${dragOverCol === key ? 'bg-blue-100' : ''}`}
                draggable
                onDragStart={e => onColDragStart(e, key)}
                onDragOver={e => onColDragOver(e, key)}
                onDrop={e => onColDrop(e, key)}
                onDragEnd={onColDragEnd}
                title="Drag to reorder column"
              >
                {key === 'bulk' ? `Bulk (${parseFloat(bulkSize) > 0 ? `${bulkSize}g` : 'g'})` : COL_DEFS[key]?.label}
              </th>
            ))}
            <th className="border border-gray-200 px-1 py-2 w-14 text-center text-gray-400 font-normal no-print">Act.</th>
          </tr>
        </thead>
        <tbody>
          {effRows.map((row, idx) => (
            <tr key={row.id}
              className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'} ${dragOverRow === idx ? 'ring-2 ring-inset ring-blue-300' : ''}`}
              onDragOver={e => onRowDragOver(e, idx)}
              onDrop={e => onRowDrop(e, idx)}
            >
              <td
                className="border border-gray-200 px-1 py-1 text-center text-gray-300 cursor-grab no-print select-none"
                title="Drag to reorder"
                draggable
                onDragStart={e => onRowDragStart(e, idx)}
                onDragEnd={onRowDragEnd}
              >≡</td>
              <td className="border border-gray-200 px-2 py-1 text-center text-gray-500">{idx + 1}</td>
              {colOrder.map(key => (
                <td key={key} className={`border border-gray-200 px-1 py-1 ${key === 'bulk' ? 'bg-blue-50/30' : ''}`}>
                  {cellFor(key, row, qsEnabled && idx === 0)}
                </td>
              ))}
              <td className="border border-gray-200 px-1 py-1 no-print">
                <div className="flex items-center justify-center gap-0.5">
                  <button onClick={() => addRowAfter(idx)} className="text-blue-300 hover:text-blue-600 px-0.5" title="Insert row below">+</button>
                  <button onClick={() => removeRow(row.id)} className="text-red-300 hover:text-red-600 px-0.5" title="Delete row">✕</button>
                </div>
              </td>
            </tr>
          ))}
          <tr className="bg-gray-100 font-semibold">
            <td className="border border-gray-200" />
            <td className="border border-gray-200 px-2 py-1.5 text-right text-xs text-gray-600">Total</td>
            {colOrder.map(key => (
              <td key={key} className="border border-gray-200 px-2 py-1.5 text-xs">
                {key === 'percent' && (
                  <div className={`text-right font-semibold ${Math.abs(total - 100) < 0.01 ? 'text-green-700' : total > 100 ? 'text-red-600' : 'text-amber-600'}`}>
                    {total.toFixed(2)}%
                  </div>
                )}
                {key === 'bulk' && parseFloat(bulkSize) > 0 && (
                  <div className="text-right text-gray-600">{(total / 100 * parseFloat(bulkSize)).toFixed(2)}g</div>
                )}
              </td>
            ))}
            <td className="border border-gray-200" />
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

// ── ProcedureEditor ───────────────────────────────────────────────────────────

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
          <textarea className="input flex-1 resize-none text-sm leading-relaxed" rows={2} value={s.text}
            onChange={e => update(s.id, e.target.value)} placeholder={`Step ${idx + 1}...`} />
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

// ── SpecsEditor ───────────────────────────────────────────────────────────────

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

// ── ImageUploader ─────────────────────────────────────────────────────────────

function ImageUploader({ label, url, filename, onUpload }) {
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
        {url && <img src={url} alt={label} className="h-16 object-contain rounded border border-gray-200 bg-white p-1" />}
        <button className="btn-secondary text-xs" onClick={() => ref.current.click()} disabled={uploading}>
          {uploading ? 'Uploading...' : (url || filename) ? 'Replace' : `Upload ${label}`}
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
  const [duplicating, setDuplicating] = useState(false)
  const saveTimer = useRef(null)
  const formDirty = useRef(false)
  const importRef = useRef(null)

  useEffect(() => {
    getFormulation(id).then(setForm).catch(() => navigate('/formulations'))
    getSamples().then(setSamples).catch(() => {})
  }, [id])

  useEffect(() => {
    if (!form || !formDirty.current) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      try { await updateFormulation(id, form); setSaved(true); setTimeout(() => setSaved(false), 2000) }
      finally { setSaving(false) }
    }, 800)
    return () => clearTimeout(saveTimer.current)
  }, [form, id])

  function update(field, val) {
    formDirty.current = true
    setForm(prev => ({ ...prev, [field]: val }))
  }

  async function handleLogoUpload(file) {
    const r = await uploadLogo(id, file)
    setForm(f => ({ ...f, logo_url: r.url, logo_filename: r.filename }))
  }

  async function handleRefImageUpload(file) {
    const r = await uploadRefImage(id, file)
    setForm(f => ({ ...f, ref_image_url: r.url, ref_image_filename: r.filename }))
  }

  async function handlePDF() {
    setGenPDF(true)
    try { await generateFormulationPDF(form) } finally { setGenPDF(false) }
  }

  async function handleDuplicate() {
    setDuplicating(true)
    try {
      const created = await createFormulation({ product_name: `Copy of ${form.product_name || 'Formulation'}` })
      const { id: _fid, logo_url, logo_filename, ref_image_url, ref_image_filename, ...rest } = form
      await updateFormulation(created.id, {
        ...rest,
        product_name: `Copy of ${form.product_name || 'Formulation'}`,
        ref_no: '',
      })
      navigate(`/formulations/${created.id}`)
    } finally { setDuplicating(false) }
  }

  function handleImport(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = evt => {
      const wb = XLSX.read(evt.target.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      if (!raw.length) return alert('No data found in file.')

      const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9%]/g, '')
      const fuzzy = (h, aliases) => { const n = norm(h); return aliases.some(a => n === a || n.includes(a) || a.includes(n)) }

      const ING_ALIASES = {
        part:        ['part', 'phase', 'section'],
        trade_name:  ['tradename', 'ingredient', 'ingredientname', 'material', 'rawmaterial', 'chemical', 'substance'],
        description: ['description', 'desc', 'details'],
        inci_name:   ['inci', 'inciname'],
        cas_no:      ['cas', 'casno', 'casnumber', 'casrn'],
        percent:     ['%', 'percent', 'percentage', 'ww', 'concentration', 'amount', 'quantity'],
        supplier:    ['supplier', 'principal', 'vendor', 'manufacturer', 'brand'],
        function:    ['function', 'role', 'purpose'],
        compliance:  ['compliance', 'regulation', 'remark', 'remarks', 'note', 'notes'],
      }

      // Find header row — first row where ≥2 cells match ingredient column aliases
      let headerRowIdx = -1
      for (let i = 0; i < Math.min(raw.length, 15); i++) {
        const matches = raw[i].filter(cell => Object.values(ING_ALIASES).some(a => fuzzy(cell, a))).length
        if (matches >= 2) { headerRowIdx = i; break }
      }

      // Scan top rows for product name (longest text) and ref no (matches ref pattern)
      const formUpdates = {}
      const refPattern = /[A-Z]{2,}\d{4,}/
      for (let i = 0; i < Math.min(headerRowIdx < 0 ? 10 : headerRowIdx, 10); i++) {
        for (const cell of raw[i]) {
          const val = String(cell).trim()
          if (!val) continue
          if (!formUpdates.ref_no && refPattern.test(val)) formUpdates.ref_no = val
          else if (!formUpdates.product_name && val.length > 5 && isNaN(val)) formUpdates.product_name = val
        }
      }

      if (headerRowIdx < 0) {
        const found = Object.keys(formUpdates)
        if (found.length) {
          formDirty.current = true
          setForm(f => ({ ...f, ...formUpdates }))
          return alert(`✓ Filled: ${found.join(', ')}\n\nNo ingredient table found. Make sure your ingredient columns have headers like:\nTrade Name, INCI Name, CAS No, %, Part, Supplier, Function`)
        }
        return alert('Could not find an ingredient table. Add column headers like: Trade Name, INCI Name, CAS No, %')
      }

      const headers = raw[headerRowIdx]
      const colMap = {}
      for (const [field, aliases] of Object.entries(ING_ALIASES)) {
        const idx = headers.findIndex(h => fuzzy(h, aliases))
        if (idx >= 0) colMap[field] = idx
      }

      const imported = raw.slice(headerRowIdx + 1)
        .filter(row => row.some(c => String(c).trim()))
        .map(row => {
          const ing = { id: uid() }
          for (const [field, idx] of Object.entries(colMap)) {
            ing[field] = String(row[idx] ?? '').trim()
          }
          return ing
        })
        .filter(ing => ing.trade_name || ing.inci_name || ing.percent)

      formDirty.current = true
      setForm(f => ({ ...f, ...formUpdates, ingredients: [...(f.ingredients || []), ...imported] }))
      alert(`✓ Done!\nProduct info filled: ${Object.keys(formUpdates).join(', ') || 'none'}\nIngredient rows imported: ${imported.length}\nColumns matched: ${Object.keys(colMap).join(', ') || 'none'}`)
    }
    reader.readAsArrayBuffer(file)
  }

  function downloadCSV() {
    const cols = mergeColOrder(form.col_order)
    const effRows = getEffRows(form.ingredients || [], form.qs_enabled)
    const hdr = ['No', ...cols.map(k => k === 'bulk' ? `Bulk (${form.bulk_size || ''}g)` : (COL_DEFS[k]?.label || k))]
    const lines = [
      hdr.join(','),
      ...effRows.map((row, i) => [
        i + 1,
        ...cols.map(k => {
          const v = k === 'bulk' ? (calcBulk(row.percent, form.bulk_size) || '') : (row[k] ?? '')
          return `"${String(v).replace(/"/g, '""')}"`
        })
      ].join(','))
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `${(form.product_name || 'formulation').replace(/[^a-z0-9]/gi, '_')}.csv`,
    })
    a.click(); URL.revokeObjectURL(a.href)
  }

  if (!form) return <div className="text-center py-20 text-gray-400">Loading...</div>

  const colOrder = mergeColOrder(form.col_order)

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2 no-print">
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs" onClick={() => navigate('/formulations')}>← Back</button>
          <span className="text-xs text-gray-400">{saving ? 'Saving...' : saved ? '✓ Saved' : 'Auto-saves'}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs" onClick={downloadCSV}>⬇ CSV</button>
          <button className="btn-secondary text-xs" onClick={() => importRef.current.click()}>⬆ Import Excel/CSV</button>
          <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
          <button className="btn-secondary text-xs" onClick={handleDuplicate} disabled={duplicating}>
            {duplicating ? 'Duplicating...' : '⧉ Duplicate'}
          </button>
          <button className="btn-primary" onClick={handlePDF} disabled={genPDF}>
            {genPDF ? '⏳ Generating...' : '⬇ Download PDF'}
          </button>
        </div>
      </div>

      {/* ── Letterhead ───────────────────────────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-6 mb-5">
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
          <div className="shrink-0">
            <ImageUploader label="Logo" url={form.logo_url} filename={form.logo_filename} onUpload={handleLogoUpload} />
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
            <div>
              <label className="label">Application</label>
              <input className="input" value={form.application || ''}
                onChange={e => update('application', e.target.value)} placeholder="e.g. Moisturizer, Serum, Cleanser..." />
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status || ''} onChange={e => update('status', e.target.value)}>
                <option value="">— Select Status —</option>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {form.status && (
                <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium border ${STATUS_COLORS[form.status] || ''}`}>
                  {form.status}
                </span>
              )}
            </div>
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
              {form.linked_sample_id && (() => {
                const ls = samples.find(s => s.id === Number(form.linked_sample_id))
                return (
                  <Link to={`/samples/${form.linked_sample_id}`}
                    className="mt-1 inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full hover:bg-blue-100 transition-colors">
                    🧪 {ls?.ref_no ? <span className="font-mono">{ls.ref_no}</span> : null}{ls?.ref_no && ls?.name ? ' — ' : ''}{ls?.name || 'View Stability Test'} →
                  </Link>
                )
              })()}
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
          qsEnabled={!!form.qs_enabled}
          onQsToggle={v => update('qs_enabled', v)}
          colOrder={colOrder}
          onColOrderChange={order => update('col_order', order)}
          onChange={rows => update('ingredients', rows)}
        />
      </div>

      {/* ── Procedure ────────────────────────────────────────────────────── */}
      <div className="card p-6">
        <h3 className="font-semibold text-gray-900 mb-3">Procedure</h3>
        <ProcedureEditor steps={form.procedure || []} onChange={steps => update('procedure', steps)} />
      </div>

      {/* ── Product Specs + Ref Image ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-6">
          <h3 className="font-semibold text-gray-900 mb-3">Product Specifications</h3>
          <SpecsEditor specs={form.specifications || []} onChange={specs => update('specifications', specs)} />
          <div className="mt-4">
            <label className="label">Remarks</label>
            <textarea className="input resize-none text-sm" rows={2} value={form.remarks}
              onChange={e => update('remarks', e.target.value)} placeholder="Additional remarks..." />
          </div>
        </div>
        <div className="card p-6">
          <h3 className="font-semibold text-gray-900 mb-3">Reference Image</h3>
          <ImageUploader label="Product Image" url={form.ref_image_url} filename={form.ref_image_filename} onUpload={handleRefImageUpload} />
          {form.ref_image_url && (
            <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden bg-gray-50 flex items-center justify-center" style={{ minHeight: 160 }}>
              <img src={form.ref_image_url} alt="Reference" className="max-h-48 object-contain" />
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
