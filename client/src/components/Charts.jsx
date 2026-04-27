import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'

const TIME_ORDER = ['Initial', '2_weeks', '1_month', '2_months', '3_months']
const TIME_LABELS = { Initial: 'Initial', '2_weeks': '2W', '1_month': '1M', '2_months': '2M', '3_months': '3M' }
const SUFFIXES = ['25', '45', '50']
const COLORS = ['#2563eb', '#d97706', '#dc2626']

function buildSeries(results, temps) {
  const byTP = Object.fromEntries(results.map(r => [r.time_point, r]))
  return TIME_ORDER.map(tp => {
    const r = byTP[tp]
    const point = { tp: TIME_LABELS[tp] }
    temps.forEach((t, i) => {
      const suf = SUFFIXES[i]
      point[`${t.value}°C`] = r?.[`ph_${suf}`] ?? null
      point[`visc_${t.value}°C`] = r?.[`viscosity_${suf}`] ?? null
    })
    return point
  })
}

function TrendChart({ title, dataKey, data, temps, unit }) {
  const hasData = data.some(d => temps.some((t) => d[`${dataKey === 'ph' ? '' : 'visc_'}${t.value}°C`] !== null))
  if (!hasData) return (
    <div className="card p-6 flex flex-col items-center justify-center h-56">
      <p className="text-2xl mb-2">📊</p>
      <p className="text-sm text-gray-400">{title} — No data yet</p>
    </div>
  )
  return (
    <div className="card p-5">
      <h3 className="font-semibold text-sm text-gray-700 mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="tp" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit={unit ? ` ${unit}` : ''} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
            formatter={(v, name) => [v !== null ? `${v}${unit ? ' ' + unit : ''}` : 'N/A', name]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {temps.map((t, i) => {
            const key = dataKey === 'ph' ? `${t.value}°C` : `visc_${t.value}°C`
            const label = dataKey === 'ph' ? `${t.value}°C` : `${t.value}°C`
            return (
              <Line key={i} type="monotone" dataKey={key} name={label}
                stroke={COLORS[i] || '#6b7280'} strokeWidth={2}
                dot={{ r: 4, fill: COLORS[i] || '#6b7280' }}
                connectNulls={false} activeDot={{ r: 6 }} />
            )
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function SummaryTable({ results, temps }) {
  const byTP = Object.fromEntries(results.map(r => [r.time_point, r]))
  const fmt = v => (v === null || v === undefined) ? '—' : Number(v).toFixed(2)
  const TEMP_COLORS = ['text-blue-600', 'text-amber-600', 'text-red-600']

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
              {temps.map((t, i) => (
                <>
                  <th key={`ph-${i}`} className={`px-3 py-2.5 text-center font-semibold ${TEMP_COLORS[i]}`}>pH {t.value}°C</th>
                  <th key={`v-${i}`} className={`px-3 py-2.5 text-center font-semibold ${TEMP_COLORS[i]}`}>Visc {t.value}°C</th>
                </>
              ))}
              <th className="px-3 py-2.5 text-left text-gray-500">Notes</th>
            </tr>
          </thead>
          <tbody>
            {TIME_ORDER.map((tp, idx) => {
              const r = byTP[tp]
              return (
                <tr key={tp} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                  <td className="px-4 py-2 font-medium text-gray-700">{TIME_LABELS[tp]}</td>
                  {temps.map((t, i) => {
                    const suf = SUFFIXES[i]
                    const isNA = (t.na_tps || []).includes(tp)
                    return (
                      <>
                        <td key={`ph-${i}`} className="px-3 py-2 text-center text-gray-700">
                          {isNA ? <span className="text-gray-300">N/A</span> : fmt(r?.[`ph_${suf}`])}
                        </td>
                        <td key={`v-${i}`} className="px-3 py-2 text-center text-gray-700">
                          {isNA ? <span className="text-gray-300">N/A</span> : fmt(r?.[`viscosity_${suf}`])}
                        </td>
                      </>
                    )
                  })}
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

export default function Charts({ results, temps }) {
  const activTemps = temps || []
  const data = buildSeries(results, activTemps)
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <TrendChart title="pH Over Time" dataKey="ph" data={data} temps={activTemps} unit="" />
        <TrendChart title="Viscosity Over Time (cP)" dataKey="visc" data={data} temps={activTemps} unit="cP" />
      </div>
      <SummaryTable results={results} temps={activTemps} />
    </div>
  )
}
