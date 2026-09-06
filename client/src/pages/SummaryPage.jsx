import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { askAgent, deleteAgentFile, getAgentFiles, getSample, getSamples, upsertResult, uploadAgentFile } from '../api'
import { extractPdfRows } from '../pdfText'

const TIME_POINTS = ['Initial', '2_weeks', '1_month', '2_months', '3_months']
const TIME_LABELS = { Initial: 'Initial', '2_weeks': '2 Weeks', '1_month': '1 Month', '2_months': '2 Months', '3_months': '3 Months' }
const SUFFIXES = ['25', '45', '50']
const STATUS_LABELS = { active: 'Active', completed: 'Completed', failed: 'Failed', on_hold: 'On Hold' }
const MEASUREMENT_FIELDS = ['pH', 'Viscosity', 'SG', 'Turbidity', 'Spindle', 'RPM']
const ENABLE_AI_AGENT = false
const IMPORT_FIELDS = ['ph', 'viscosity', 'sg', 'turbidity', 'spindle', 'rpm']
const NUMERIC_IMPORT_FIELDS = new Set(['ph', 'viscosity', 'sg', 'turbidity', 'rpm'])

function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/[°()]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

function findColumn(headers, ...names) {
  const normalized = headers.map(normalizeHeader)
  const candidates = names.map(normalizeHeader)
  const index = normalized.findIndex(header => candidates.some(candidate => header === candidate || header.includes(candidate)))
  return index === -1 ? null : index
}

function parseImportMatrix(matrix, samples) {
  const headerRowIndex = matrix.findIndex(row => {
    const headers = row || []
    return findColumn(headers, 'sample name', 'sample', 'product name', 'product', 'test sample') !== null
      && findColumn(headers, 'time point', 'timepoint', 'duration', 'interval', 'test point', 'age') !== null
  })
  if (headerRowIndex < 0) throw new Error('Could not detect a table header with sample and time-point columns.')
  const headers = matrix[headerRowIndex] || []
  const sampleNameColumn = findColumn(headers, 'sample name', 'sample', 'product name', 'product', 'test sample')
  const refColumn = findColumn(headers, 'ref no', 'reference number', 'reference', 'ref', 'sample code', 'sample id', 'code')
  const timeColumn = findColumn(headers, 'time point', 'timepoint', 'duration', 'interval', 'test point', 'age')
  if (sampleNameColumn === null && refColumn === null) throw new Error('Could not detect a sample name or reference-number column.')

  const rows = []
  let previousSampleName = ''
  let previousRefNo = ''
  matrix.slice(headerRowIndex + 1).forEach((values, index) => {
    if (!values.some(value => String(value).trim())) return
    const sampleName = String(sampleNameColumn === null ? '' : values[sampleNameColumn] || '').trim() || previousSampleName
    const refNo = String(refColumn === null ? '' : values[refColumn] || '').trim() || previousRefNo
    previousSampleName = sampleName
    previousRefNo = refNo
    const sample = samples.find(item => refNo && item.ref_no && item.ref_no.toLowerCase() === refNo.toLowerCase())
      || samples.find(item => sampleName && item.name.toLowerCase() === sampleName.toLowerCase())
    const rawTimePoint = String(timeColumn === null ? '' : values[timeColumn] || '').trim().toLowerCase()
    const timePoint = TIME_POINTS.find(point => point.toLowerCase() === rawTimePoint || TIME_LABELS[point].toLowerCase() === rawTimePoint)
    const data = { time_point: timePoint }
    SUFFIXES.forEach(suffix => IMPORT_FIELDS.forEach(field => {
      const column = findColumn(headers, `${field} ${suffix}c`, `${field} ${suffix}`)
      if (column !== null && values[column] !== '') data[`${field}_${suffix}`] = NUMERIC_IMPORT_FIELDS.has(field) ? Number(values[column]) : String(values[column])
    }))
    const textColumns = { appearance: ['appearance'], color_obs: ['color'], odor: ['odor'], phase_sep: ['phase sep', 'phase separation'], microbial: ['microbial'], notes: ['notes'], measured_at: ['measured at', 'measurement date'] }
    Object.entries(textColumns).forEach(([field, names]) => {
      const column = findColumn(headers, ...names)
      if (column !== null && values[column] !== '') data[field] = String(values[column])
    })
    rows.push({ id: `${index}-${sampleName}-${rawTimePoint}`, line: headerRowIndex + index + 2, sample, sampleName, refNo, timePoint, data, error: !sample ? 'Sample not found' : !timePoint ? 'Invalid time point' : '' })
  })
  if (!rows.length) throw new Error('The detected table has no data rows.')
  return rows
}

function parseImportRows(workbook, samples) {
  const dataSheetName = workbook.SheetNames.find(name => normalizeHeader(name) === 'recorded data') || workbook.SheetNames[0]
  return parseImportMatrix(XLSX.utils.sheet_to_json(workbook.Sheets[dataSheetName], { header: 1, defval: '' }), samples)
}

function BulkImportPanel({ samples, onImported }) {
  const fileRef = useRef(null)
  const [rows, setRows] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [sourceFile, setSourceFile] = useState(null)

  async function readFile(event) {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return
    setSourceFile(file)
    await extractFile(file)
  }

  async function extractFile(file) {
    try {
      const parsed = file.name.toLowerCase().endsWith('.pdf')
        ? parseImportMatrix(await extractPdfRows(file), samples)
        : parseImportRows(XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true }), samples)
      setRows(parsed); setSelected(new Set(parsed.filter(row => !row.error).map(row => row.id))); setError('')
    } catch (err) { setRows([]); setSelected(new Set()); setError(err.message || 'Could not read the Excel file.') }
  }

  async function confirmImport() {
    const validRows = rows.filter(row => selected.has(row.id) && !row.error)
    if (!validRows.length) return
    setSaving(true); setError('')
    try {
      for (const row of validRows) await upsertResult(row.sample.id, row.data)
      setRows([]); setSelected(new Set()); await onImported()
    } catch (err) { setError(err.response?.data?.error || 'Some rows could not be imported.') }
    finally { setSaving(false) }
  }

  return (
    <section className="card p-4 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold text-gray-900">Bulk Data Import</h2><p className="text-xs text-gray-500 mt-1">Import XLS, XLSX, or text-based PDF files with a preview before saving. Scanned image-only PDFs need OCR.</p></div>
        <div className="flex gap-2"><button className="btn-secondary text-xs" onClick={() => fileRef.current?.click()}>Choose XLS, XLSX, or PDF</button>{sourceFile && <button className="btn-secondary text-xs" onClick={() => extractFile(sourceFile)}>↻ Redo extraction</button>}</div>
        <input ref={fileRef} type="file" className="hidden" accept=".xls,.xlsx,.pdf" onChange={readFile} />
      </div>
      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
      {rows.length > 0 && <>
        <div className="flex items-center justify-between mt-4 mb-2"><p className="text-xs text-gray-600">{selected.size} of {rows.filter(row => !row.error).length} valid rows selected</p><button className="btn-primary text-xs" disabled={saving || !selected.size} onClick={confirmImport}>{saving ? 'Saving...' : 'Confirm and Save'}</button></div>
        <div className="max-h-64 overflow-auto border border-gray-200 rounded-lg"><table className="w-full text-xs"><thead className="bg-gray-50"><tr><th className="px-2 py-2 text-left">Use</th><th className="px-2 py-2 text-left">Line</th><th className="px-2 py-2 text-left">Sample</th><th className="px-2 py-2 text-left">Ref No</th><th className="px-2 py-2 text-left">Time Point</th><th className="px-2 py-2 text-left">Status</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-gray-100"><td className="px-2 py-2"><input type="checkbox" disabled={!!row.error} checked={selected.has(row.id)} onChange={() => setSelected(previous => { const next = new Set(previous); next.has(row.id) ? next.delete(row.id) : next.add(row.id); return next })} /></td><td className="px-2 py-2">{row.line}</td><td className="px-2 py-2">{row.sampleName}</td><td className="px-2 py-2">{row.refNo}</td><td className="px-2 py-2">{row.timePoint ? TIME_LABELS[row.timePoint] : '—'}</td><td className={`px-2 py-2 ${row.error ? 'text-red-600' : 'text-green-600'}`}>{row.error || 'Ready'}</td></tr>)}</tbody></table></div>
      </>}
    </section>
  )
}

function getRows(samples) {
  return samples.flatMap(sample => {
    const results = Object.fromEntries((sample.results || []).map(result => [result.time_point, result]))
    return TIME_POINTS.map(timePoint => {
      const result = results[timePoint] || {}
      const row = {
        sampleId: sample.id,
        sampleName: sample.name || '',
        refNo: sample.ref_no || '',
        status: STATUS_LABELS[sample.status || 'active'] || sample.status || 'Active',
        dateStarted: sample.date_started || '',
        timePoint: TIME_LABELS[timePoint],
      }
      SUFFIXES.forEach(suffix => {
        ;['ph', 'viscosity', 'sg', 'turbidity', 'spindle', 'rpm'].forEach(field => {
          row[`${field}_${suffix}`] = result[`${field}_${suffix}`] ?? ''
        })
      })
      row.appearance = result.appearance || ''
      row.color = result.color_obs || ''
      row.odor = result.odor || ''
      row.phaseSep = result.phase_sep || ''
      row.microbial = result.microbial || ''
      row.notes = result.notes || ''
      row.measuredAt = result.measured_at || ''
      return row
    })
  })
}

function getDataRows(rows) {
  return rows.map(row => [
    row.sampleName, row.refNo, row.status, row.dateStarted, row.timePoint,
    ...SUFFIXES.flatMap(suffix => ['ph', 'viscosity', 'sg', 'turbidity', 'spindle', 'rpm'].map(field => row[`${field}_${suffix}`])),
    row.appearance, row.color, row.odor, row.phaseSep, row.microbial, row.notes, row.measuredAt,
  ])
}

function AgentPanel() {
  const fileRef = useRef(null)
  const [files, setFiles] = useState([])
  const [message, setMessage] = useState('')
  const [conversation, setConversation] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { getAgentFiles().then(setFiles).catch(() => {}) }, [])

  async function handleUpload(event) {
    const file = event.target.files[0]
    if (!file) return
    setError('')
    try {
      await uploadAgentFile(file)
      setFiles(await getAgentFiles())
    } catch (err) {
      setError(err.response?.data?.error || 'File upload failed.')
    } finally { event.target.value = '' }
  }

  async function handleAsk(event) {
    event.preventDefault()
    const prompt = message.trim()
    if (!prompt || busy) return
    setMessage(''); setError(''); setConversation(previous => [...previous, { role: 'user', text: prompt }]); setBusy(true)
    try {
      const result = await askAgent(prompt)
      setConversation(previous => [...previous, { role: 'agent', text: result.message }])
    } catch (err) {
      setError(err.response?.data?.error || 'The agent could not respond.')
    } finally { setBusy(false) }
  }

  async function handleDelete(name) {
    try { await deleteAgentFile(name); setFiles(await getAgentFiles()) }
    catch { setError('Could not remove the file.') }
  }

  return (
    <section className="card p-4 mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-semibold text-gray-900">AI Data Assistant</h2>
          <p className="text-xs text-gray-500 mt-1">Ask about samples or upload XLS, XLSX, PDF, PNG, JPG, CSV, JSON, TXT, or Markdown files. The agent only proposes changes; it never saves measurements automatically.</p>
        </div>
        <button className="btn-secondary text-xs" onClick={() => fileRef.current?.click()}>+ Add reference file</button>
        <input ref={fileRef} type="file" className="hidden" accept=".txt,.csv,.json,.md,.xls,.xlsx,.pdf,.png,.jpg,.jpeg,.webp" onChange={handleUpload} />
      </div>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {files.map(file => <span key={file.name} className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">{file.name}<button className="text-gray-400 hover:text-red-500" title="Remove file" onClick={() => handleDelete(file.name)}>×</button></span>)}
        </div>
      )}
      {conversation.length > 0 && <div className="max-h-64 overflow-y-auto space-y-2 mb-3 rounded-lg bg-gray-50 p-3">{conversation.map((item, index) => <div key={index} className={item.role === 'user' ? 'text-right' : 'text-left'}><span className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-xs ${item.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>{item.text}</span></div>)}</div>}
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <form onSubmit={handleAsk} className="flex gap-2">
        <input className="input flex-1 text-sm" value={message} onChange={event => setMessage(event.target.value)} placeholder="Ask about samples, missing data, or paste measurements to review..." />
        <button className="btn-primary text-sm" disabled={busy || !message.trim()}>{busy ? 'Thinking...' : 'Ask agent'}</button>
      </form>
    </section>
  )
}

export default function SummaryPage() {
  const [samples, setSamples] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function reloadSamples() {
    try {
      const sampleList = await getSamples()
      const details = await Promise.all(sampleList.map(sample => getSample(sample.id)))
      setSamples(details)
      setSelectedIds(previous => previous.size ? new Set(details.filter(sample => previous.has(sample.id)).map(sample => sample.id)) : new Set(details.map(sample => sample.id)))
    } catch {
      setError('Unable to load sample data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reloadSamples() }, [])

  const filteredSamples = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return samples
    return samples.filter(sample => `${sample.name} ${sample.ref_no || ''}`.toLowerCase().includes(query))
  }, [samples, search])

  const visibleRows = useMemo(() => getRows(filteredSamples), [filteredSamples])
  const selectedSamples = samples.filter(sample => selectedIds.has(sample.id))

  function toggleSample(id) {
    setSelectedIds(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectVisible(select) {
    setSelectedIds(previous => {
      const next = new Set(previous)
      filteredSamples.forEach(sample => select ? next.add(sample.id) : next.delete(sample.id))
      return next
    })
  }

  function downloadExcel() {
    const selectedRows = getRows(selectedSamples)
    const dataHeader = [
      'Sample Name', 'Ref No', 'Status', 'Date Started', 'Time Point',
      ...SUFFIXES.flatMap(suffix => MEASUREMENT_FIELDS.map(field => `${field} ${suffix}°C`)),
      'Appearance', 'Color', 'Odor', 'Phase Sep', 'Microbial', 'Notes', 'Measured At',
    ]
    const summaryRows = [
      ['Sample Name', 'Ref No', 'Status', 'Date Started', 'Remarks', 'Recorded Time Points'],
      ...selectedSamples.map(sample => [
        sample.name || '', sample.ref_no || '', STATUS_LABELS[sample.status || 'active'] || sample.status || 'Active',
        sample.date_started || '', sample.remarks || '', (sample.results || []).length,
      ]),
    ]
    const workbook = XLSX.utils.book_new()
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows)
    const dataSheet = XLSX.utils.aoa_to_sheet([dataHeader, ...getDataRows(selectedRows)])
    summarySheet['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 45 }, { wch: 22 }]
    dataSheet['!cols'] = dataHeader.map((_, index) => ({ wch: index < 5 ? 18 : 15 }))
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Sample Summary')
    XLSX.utils.book_append_sheet(workbook, dataSheet, 'Recorded Data')
    XLSX.writeFile(workbook, `all_samples_summary_${new Date().toISOString().split('T')[0]}.xls`, { bookType: 'xls' })
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading summary...</div>
  if (error) return <div className="text-center py-20 text-red-500">{error}</div>

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Samples Summary</h1>
          <p className="text-sm text-gray-500 mt-1">View recorded measurements across every stability test.</p>
        </div>
        <button className="btn-primary" onClick={downloadExcel} disabled={selectedSamples.length === 0}>
          ⬇ Download Selected XLS ({selectedSamples.length})
        </button>
      </div>

      {ENABLE_AI_AGENT && <AgentPanel />}

      <BulkImportPanel samples={samples} onImported={reloadSamples} />

      <div className="card p-4 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <input className="input max-w-sm" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search sample or reference..." />
          <button className="btn-secondary text-xs" onClick={() => selectVisible(true)}>Select Visible</button>
          <button className="btn-secondary text-xs" onClick={() => selectVisible(false)}>Clear Visible</button>
          <span className="text-xs text-gray-500">{selectedSamples.length} of {samples.length} samples selected</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-xs border-collapse" style={{ minWidth: 2200 }}>
          <thead>
            <tr className="bg-gray-50">
              {['Sample', 'Ref No', 'Status', 'Started', 'Time Point'].map(column => <th key={column} className="border border-gray-200 px-3 py-2 text-left whitespace-nowrap">{column}</th>)}
              {SUFFIXES.flatMap(suffix => MEASUREMENT_FIELDS.map(field => <th key={`${field}-${suffix}`} className="border border-gray-200 px-3 py-2 text-center whitespace-nowrap">{field} {suffix}°C</th>))}
              {['Appearance', 'Color', 'Odor', 'Phase Sep', 'Microbial', 'Notes', 'Measured At'].map(column => <th key={column} className="border border-gray-200 px-3 py-2 text-center whitespace-nowrap">{column}</th>)}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={`${row.sampleId}-${row.timePoint}`} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                {(index === 0 || visibleRows[index - 1].sampleId !== row.sampleId) && (() => {
                  const sampleRowCount = visibleRows.filter(visibleRow => visibleRow.sampleId === row.sampleId).length
                  return (
                    <Fragment key={row.sampleId}>
                      <td rowSpan={sampleRowCount} className="border border-gray-200 px-3 py-2 whitespace-nowrap align-middle">
                        <label className="flex items-center gap-2 font-medium text-gray-700"><input type="checkbox" checked={selectedIds.has(row.sampleId)} onChange={() => toggleSample(row.sampleId)} />{row.sampleName}</label>
                      </td>
                      <td rowSpan={sampleRowCount} className="border border-gray-200 px-3 py-2 whitespace-nowrap align-middle">{row.refNo}</td>
                      <td rowSpan={sampleRowCount} className="border border-gray-200 px-3 py-2 whitespace-nowrap align-middle">{row.status}</td>
                      <td rowSpan={sampleRowCount} className="border border-gray-200 px-3 py-2 whitespace-nowrap align-middle">{row.dateStarted}</td>
                    </Fragment>
                  )
                })()}
                <td className="border border-gray-200 px-3 py-2 whitespace-nowrap font-medium">{row.timePoint}</td>
                {SUFFIXES.flatMap(suffix => ['ph', 'viscosity', 'sg', 'turbidity', 'spindle', 'rpm'].map(field => <td key={`${suffix}-${field}`} className="border border-gray-200 px-3 py-2 text-center">{row[`${field}_${suffix}`]}</td>))}
                {[row.appearance, row.color, row.odor, row.phaseSep, row.microbial, row.notes, row.measuredAt].map((value, valueIndex) => <td key={valueIndex} className="border border-gray-200 px-3 py-2">{value}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visibleRows.length === 0 && <p className="text-center text-gray-400 py-10">No samples match your search.</p>}
    </div>
  )
}
