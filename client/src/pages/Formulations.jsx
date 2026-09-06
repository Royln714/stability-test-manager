import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { getFormulations, createFormulation, deleteFormulation, getSamples } from '../api'
import * as XLSX from 'xlsx'

const FORMULATION_FIELDS = ['part', 'trade_name', 'description', 'inci_name', 'cas_no', 'percent', 'supplier', 'function', 'compliance']
const FORMULATION_ALIASES = {
  part: ['part', 'phase', 'section'], trade_name: ['trade name', 'ingredient', 'ingredient name', 'material', 'raw material', 'chemical'],
  description: ['description', 'details'], inci_name: ['inci', 'inci name'], cas_no: ['cas', 'cas no', 'cas number', 'cas rn'],
  percent: ['%', 'percent', 'percentage', 'concentration', 'amount', 'quantity'], supplier: ['supplier', 'principal', 'vendor', 'manufacturer', 'brand'],
  function: ['function', 'role', 'purpose'], compliance: ['compliance', 'regulation', 'remark', 'remarks', 'note', 'notes'],
}

function normalizeCell(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim() }

function parseFormulationSheet(sheet, sheetName) {
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (!raw.length) return { product_name: sheetName, ingredients: [] }
  const matches = row => row.filter(cell => Object.values(FORMULATION_ALIASES).some(aliases => aliases.some(alias => normalizeCell(cell).includes(normalizeCell(alias)))))
  const headerRow = raw.findIndex(row => matches(row).length >= 2)
  const scanRows = headerRow < 0 ? raw.slice(0, 15) : raw.slice(0, headerRow)
  const metadata = { product_name: sheetName, ref_no: '', description: '', application: '', bulk_size: '', status: '', company_name: '', company_address: '', company_tel: '', company_fax: '', remarks: '' }
  const labelMap = {
    'product name': 'product_name', product: 'product_name', formulation: 'product_name', name: 'product_name',
    'ref no': 'ref_no', reference: 'ref_no', 'reference number': 'ref_no', 'batch no': 'ref_no',
    description: 'description', application: 'application', 'bulk size': 'bulk_size', 'batch size': 'bulk_size',
    status: 'status', company: 'company_name', 'company name': 'company_name', address: 'company_address',
    telephone: 'company_tel', phone: 'company_tel', tel: 'company_tel', fax: 'company_fax', remarks: 'remarks', notes: 'remarks',
  }
  scanRows.forEach(row => row.forEach((cell, index) => {
    const label = normalizeCell(cell).replace(/:$/, '')
    const field = Object.entries(labelMap).find(([key]) => label === key || label.startsWith(`${key} `))?.[1]
    if (field) {
      const next = String(row[index + 1] || '').trim()
      if (next) metadata[field] = next
    }
  }))
  const refPattern = /[A-Z]{2,}[\w/-]{2,}/i
  scanRows.flat().map(value => String(value).trim()).filter(Boolean).forEach(value => {
    if (!metadata.ref_no && refPattern.test(value) && value.length < 40) metadata.ref_no = value
    else if (metadata.product_name === sheetName && value.length > 3 && isNaN(Number(value)) && !labelMap[normalizeCell(value)]) metadata.product_name = value
  })
  if (headerRow < 0) return { ...metadata, ingredients: [], procedure: [{ id: 1, text: '' }], specifications: [] }
  const headers = raw[headerRow]
  const colMap = {}
  FORMULATION_FIELDS.forEach(field => {
    const index = headers.findIndex(header => FORMULATION_ALIASES[field].some(alias => normalizeCell(header).includes(normalizeCell(alias))))
    if (index >= 0) colMap[field] = index
  })
  let currentPart = ''
  const ingredients = raw.slice(headerRow + 1).filter(row => row.some(value => String(value).trim())).map(row => {
    const ingredient = { id: Date.now() + Math.random() }
    FORMULATION_FIELDS.forEach(field => { if (colMap[field] !== undefined) ingredient[field] = String(row[colMap[field]] ?? '').trim() })
    if (ingredient.part) currentPart = ingredient.part
    else ingredient.part = currentPart
    return ingredient
  }).filter(row => row.trade_name || row.inci_name || row.percent)
  const bulkHeader = headers.map(value => String(value).match(/(\d+(?:\.\d+)?)\s*g/i)).find(Boolean)
  if (!metadata.bulk_size && bulkHeader) metadata.bulk_size = bulkHeader[1]
  return { ...metadata, ingredients, procedure: [{ id: 1, text: '' }], specifications: [{ id: 1, property: 'Appearance', value: '' }, { id: 2, property: 'Viscosity', value: '' }, { id: 3, property: 'pH', value: '' }] }
}

export default function Formulations() {
  const [list, setList] = useState([])
  const [samples, setSamples] = useState([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const importRef = useRef(null)
  const navigate = useNavigate()

  async function handleWorkbookImport(event) {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return
    setImporting(true)
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      for (const sheetName of workbook.SheetNames) await createFormulation(parseFormulationSheet(workbook.Sheets[sheetName], sheetName))
      setList(await getFormulations())
      alert(`Imported ${workbook.SheetNames.length} formulation sheet${workbook.SheetNames.length === 1 ? '' : 's'}.`)
    } catch (error) {
      alert(error.response?.data?.error || 'Could not import the workbook.')
    } finally { setImporting(false) }
  }

  useEffect(() => {
    Promise.all([getFormulations(), getSamples().catch(() => [])])
      .then(([fmts, samps]) => { setList(fmts); setSamples(samps) })
      .finally(() => setLoading(false))
  }, [])

  async function handleNew() {
    const f = await createFormulation({
      product_name: 'New Formulation',
      ingredients: [{ id: 1, part: 'A', trade_name: '', inci_name: '', cas_no: '', percent: '', supplier: '', function: '', compliance: '' }],
      procedure: [{ id: 1, text: '' }],
      specifications: [
        { id: 1, property: 'Appearance', value: '' },
        { id: 2, property: 'Viscosity', value: '' },
        { id: 3, property: 'pH', value: '' },
      ],
    })
    navigate(`/formulations/${f.id}`)
  }

  async function handleDelete(e, id, name) {
    e.stopPropagation()
    if (!confirm(`Delete "${name}"?`)) return
    await deleteFormulation(id)
    setList(prev => prev.filter(x => x.id !== id))
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Formulation Sheets</h1>
          <p className="text-sm text-gray-500 mt-1">Product formulas with ingredients, procedure and specifications</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary text-sm" onClick={() => importRef.current?.click()} disabled={importing}>{importing ? 'Importing...' : '⬆ Import Workbook'}</button>
          <input ref={importRef} type="file" className="hidden" accept=".xls,.xlsx" onChange={handleWorkbookImport} />
          <button className="btn-primary" onClick={handleNew}>+ New Formulation</button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-3">🧴</p>
          <p className="text-gray-500 font-medium">No formulations yet</p>
          <p className="text-sm text-gray-400 mt-1">Click "+ New Formulation" to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map(f => {
            const linkedSample = f.linked_sample_id ? samples.find(s => s.id === Number(f.linked_sample_id)) : null
            return (
              <div key={f.id} className="card p-5 cursor-pointer hover:shadow-md hover:border-blue-200 transition-all group"
                onClick={() => navigate(`/formulations/${f.id}`)}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate group-hover:text-blue-700">{f.product_name || 'Untitled'}</h3>
                    {f.ref_no && <p className="text-xs font-mono text-gray-400 mt-0.5">{f.ref_no}</p>}
                    {f.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{f.description}</p>}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
                  <span>🧪 {(f.ingredients || []).length} ingredients</span>
                  <span>📋 {(f.procedure || []).length} steps</span>
                  <span>📅 {f.created_at?.slice(0, 10)}</span>
                </div>
                {linkedSample && (
                  <Link
                    to={`/samples/${linkedSample.id}`}
                    onClick={e => e.stopPropagation()}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full hover:bg-blue-100 transition-colors"
                  >
                    🧪 {linkedSample.ref_no ? <span className="font-mono">{linkedSample.ref_no}</span> : linkedSample.name} →
                  </Link>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-blue-600 group-hover:underline">Open →</span>
                  <button className="btn-danger text-xs py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => handleDelete(e, f.id, f.product_name)}>Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
