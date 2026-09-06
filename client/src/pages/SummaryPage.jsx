import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { getSample, getSamples } from '../api'

const TIME_POINTS = ['Initial', '2_weeks', '1_month', '2_months', '3_months']
const TIME_LABELS = { Initial: 'Initial', '2_weeks': '2 Weeks', '1_month': '1 Month', '2_months': '2 Months', '3_months': '3 Months' }
const SUFFIXES = ['25', '45', '50']
const STATUS_LABELS = { active: 'Active', completed: 'Completed', failed: 'Failed', on_hold: 'On Hold' }
const MEASUREMENT_FIELDS = ['pH', 'Viscosity', 'SG', 'Turbidity', 'Spindle', 'RPM']

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

export default function SummaryPage() {
  const [samples, setSamples] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const sampleList = await getSamples()
        const details = await Promise.all(sampleList.map(sample => getSample(sample.id)))
        setSamples(details)
        setSelectedIds(new Set(details.map(sample => sample.id)))
      } catch {
        setError('Unable to load sample data.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

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
                <td className="border border-gray-200 px-3 py-2 whitespace-nowrap">
                  <label className="flex items-center gap-2 font-medium text-gray-700"><input type="checkbox" checked={selectedIds.has(row.sampleId)} onChange={() => toggleSample(row.sampleId)} />{row.sampleName}</label>
                </td>
                <td className="border border-gray-200 px-3 py-2 whitespace-nowrap">{row.refNo}</td>
                <td className="border border-gray-200 px-3 py-2 whitespace-nowrap">{row.status}</td>
                <td className="border border-gray-200 px-3 py-2 whitespace-nowrap">{row.dateStarted}</td>
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
