import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'

const TIME_ORDER = ['Initial', '2_weeks', '1_month', '2_months', '3_months']
const TIME_LABELS = { Initial: 'Initial', '2_weeks': '2W', '1_month': '1M', '2_months': '2M', '3_months': '3M' }

const COLORS = { 25: '#2563eb', 45: '#d97706', 50: '#dc2626' }

function buildSeries(results, field25, field45, field50) {
  const byTP = Object.fromEntries(results.map(r => [r.time_point, r]))
  return TIME_ORDER.map(tp => {
    const r = byTP[tp]
    return {
      tp: TIME_LABELS[tp],
      '25°C': r?.[field25] ?? null,
      '45°C': r?.[field45] ?? null,
      '50°C': r?.[field50] ?? null,
    }
  })
}

function TrendChart({ title, data, unit }) {
  const hasData = data.some(d => d['25°C'] !== null || d['45°C'] !== null || d['50°C'] !== null)
  if (!hasData) {
    return (
      <div className="card p-6 flex flex-col items-center justify-center h-56">
        <p className="text-2xl mb-2">📊</p>
        <p className="text-sm text-gray-400">{title} — No data yet</p>
      </div>
    )
  }
  return (
    <div className="card p-5">
      <h3 className="font-semibold text-sm text-gray-700 mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="tp" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit={unit ? ` ${unit}` : ''} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
            formatter={(v, name) => [v !== null ? `${v}${unit ? ' ' + unit : ''}` : 'N/A', name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {['25°C', '45°C', '50°C'].map(temp => (
            <Line
              key={temp}
              type="monotone"
              dataKey={temp}
              stroke={COLORS[parseInt(temp)]}
              strokeWidth={2}
              dot={{ r: 4, fill: COLORS[parseInt(temp)] }}
              connectNulls={false}
              activeDot={{ r: 6 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function SummaryTable({ results }) {
  const byTP = Object.fromEntries(results.map(r => [r.time_point, r]))
  const fmt = v => (v === null || v === undefined) ? '—' : Number(v).toFixed(2)

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-sm text-gray-700">Data Summary</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Time Point</th>
              <th className="px-3 py-2.5 text-center font-semibold text-blue-600">pH 25°C</th>
              <th className="px-3 py-2.5 text-center font-semibold text-blue-600">Visc 25°C</th>
              <th className="px-3 py-2.5 text-center font-semibold text-amber-600">pH 45°C</th>
              <th className="px-3 py-2.5 text-center font-semibold text-amber-600">Visc 45°C</th>
              <th className="px-3 py-2.5 text-center font-semibold text-red-600">pH 50°C</th>
              <th className="px-3 py-2.5 text-center font-semibold text-red-600">Visc 50°C</th>
              <th className="px-3 py-2.5 text-left text-gray-500">Notes</th>
            </tr>
          </thead>
          <tbody>
            {TIME_ORDER.map((tp, i) => {
              const r = byTP[tp]
              return (
                <tr key={tp} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                  <td className="px-4 py-2 font-medium text-gray-700">{TIME_LABELS[tp] === 'Initial' ? 'Initial' : TIME_LABELS[tp]}</td>
                  <td className="px-3 py-2 text-center text-gray-700">{fmt(r?.ph_25)}</td>
                  <td className="px-3 py-2 text-center text-gray-700">{fmt(r?.viscosity_25)}</td>
                  <td className="px-3 py-2 text-center text-gray-700">{tp === 'Initial' ? <span className="text-gray-300">N/A</span> : fmt(r?.ph_45)}</td>
                  <td className="px-3 py-2 text-center text-gray-700">{tp === 'Initial' ? <span className="text-gray-300">N/A</span> : fmt(r?.viscosity_45)}</td>
                  <td className="px-3 py-2 text-center text-gray-700">{(tp === 'Initial' || tp === '2_weeks') ? <span className="text-gray-300">N/A</span> : fmt(r?.ph_50)}</td>
                  <td className="px-3 py-2 text-center text-gray-700">{(tp === 'Initial' || tp === '2_weeks') ? <span className="text-gray-300">N/A</span> : fmt(r?.viscosity_50)}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{r?.notes || ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Charts({ results }) {
  const phData = buildSeries(results, 'ph_25', 'ph_45', 'ph_50')
  const viscData = buildSeries(results, 'viscosity_25', 'viscosity_45', 'viscosity_50')

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <TrendChart title="pH Over Time" data={phData} unit="" />
        <TrendChart title="Viscosity Over Time (cP)" data={viscData} unit="cP" />
      </div>
      <SummaryTable results={results} />
    </div>
  )
}
