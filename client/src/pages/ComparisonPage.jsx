import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getSamples, getSample } from '../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const TIME_ORDER = ['Initial', '2_weeks', '1_month', '2_months', '3_months']
const TIME_LABELS = { Initial: 'Initial', '2_weeks': '2W', '1_month': '1M', '2_months': '2M', '3_months': '3M' }
const SUFFIXES = ['25', '45', '50']
const LINE_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#d97706', '#0891b2', '#be185d', '#065f46']
const MAX_SAMPLES = 6

function buildCompareData(samples) {
  return TIME_ORDER.map(tp => {
    const point = { tp: TIME_LABELS[tp] }
    samples.forEach((s, si) => {
      const r = s.results?.find(x => x.time_point === tp)
      const temps = s.temps || [{ value: 25 }, { value: 45 }, { value: 50 }]
      temps.forEach((t, ti) => {
        const suf = SUFFIXES[ti]
        point[`${s.name} pH ${t.value}°C`] = r?.[`ph_${suf}`] ?? null
        point[`${s.name} Visc ${t.value}°C`] = r?.[`viscosity_${suf}`] ?? null
      })
    })
    return point
  })
}

function CompareChart({ title, samples, dataKey, unit }) {
  const data = buildCompareData(samples)
  const lines = []
  samples.forEach((s, si) => {
    const temps = s.temps || [{ value: 25 }, { value: 45 }, { value: 50 }]
    temps.forEach((t, ti) => {
      const key = dataKey === 'ph' ? `${s.name} pH ${t.value}°C` : `${s.name} Visc ${t.value}°C`
      lines.push({ key, color: LINE_COLORS[(si * 3 + ti) % LINE_COLORS.length] })
    })
  })
  return (
    <div className="card p-5">
      <h3 className="font-semibold text-sm text-gray-700 mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="tp" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit={unit ? ` ${unit}` : ''} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }}
            formatter={(v, name) => [v !== null ? `${v}${unit ? ' ' + unit : ''}` : 'N/A', name]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {lines.map(l => (
            <Line key={l.key} type="monotone" dataKey={l.key} stroke={l.color}
              strokeWidth={2} dot={{ r: 3 }} connectNulls={false} activeDot={{ r: 5 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function ComparisonPage() {
  const [allSamples, setAllSamples] = useState([])
  const [slots, setSlots] = useState([null, null])
  const [loaded, setLoaded] = useState([null, null])
  const [loading, setLoading] = useState(false)

  useEffect(() => { getSamples().then(setAllSamples).catch(() => {}) }, [])

  async function pickSample(idx, id) {
    const nextSlots = [...slots]
    nextSlots[idx] = id ? Number(id) : null
    setSlots(nextSlots)
    if (!id) {
      const nextLoaded = [...loaded]; nextLoaded[idx] = null; setLoaded(nextLoaded); return
    }
    setLoading(true)
    try {
      const s = await getSample(Number(id))
      const nextLoaded = [...loaded]; nextLoaded[idx] = s; setLoaded(nextLoaded)
    } finally { setLoading(false) }
  }

  function addSlot() {
    setSlots(s => [...s, null])
    setLoaded(l => [...l, null])
  }

  function removeSlot(idx) {
    setSlots(s => s.filter((_, i) => i !== idx))
    setLoaded(l => l.filter((_, i) => i !== idx))
  }

  const activeSamples = loaded.filter(Boolean)
  const canCompare = activeSamples.length >= 2

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Sample Comparison</h1>
        <p className="text-sm text-gray-500 mt-1">Select up to {MAX_SAMPLES} samples to overlay their pH and viscosity trends</p>
      </div>

      <div className="card p-5 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {slots.map((sel, idx) => (
            <div key={idx}>
              <div className="flex items-center justify-between mb-1">
                <label className="label mb-0">Sample {idx + 1}</label>
                {slots.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeSlot(idx)}
                    className="text-xs text-red-400 hover:text-red-600 font-medium"
                  >
                    Remove
                  </button>
                )}
              </div>
              <select className="input" value={sel || ''} onChange={e => pickSample(idx, e.target.value)}>
                <option value="">— Select a sample —</option>
                {allSamples.map(s => (
                  <option key={s.id} value={s.id}
                    disabled={slots.some((sid, si) => si !== idx && sid === s.id)}>
                    {s.ref_no ? `[${s.ref_no}] ` : ''}{s.name}
                  </option>
                ))}
              </select>
              {loaded[idx] && (
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                  <span>Started: {loaded[idx].date_started || '—'}</span>
                  <span>· {loaded[idx].results?.length || 0}/5 time points</span>
                </div>
              )}
            </div>
          ))}
        </div>
        {slots.length < MAX_SAMPLES && (
          <button
            type="button"
            onClick={addSlot}
            className="mt-4 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
          >
            <span className="text-base leading-none">+</span> Add another sample
          </button>
        )}
      </div>

      {loading && <div className="text-center py-10 text-gray-400">Loading...</div>}

      {!loading && !canCompare && (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-gray-500 font-medium">Select at least two samples above to compare</p>
        </div>
      )}

      {!loading && canCompare && (
        <div className="space-y-5">
          <div className="flex gap-3 flex-wrap">
            {activeSamples.map((s, i) => (
              <Link key={i} to={`/samples/${s.id}`}
                className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 font-medium hover:bg-blue-100 transition-colors">
                <span className="w-3 h-3 rounded-full inline-block shrink-0" style={{ background: LINE_COLORS[i * 3 % LINE_COLORS.length] }} />
                {s.ref_no ? <span className="font-mono text-xs">{s.ref_no}</span> : null}{s.ref_no && s.name ? ' — ' : ''}{s.name}
              </Link>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <CompareChart title="pH Comparison" samples={activeSamples} dataKey="ph" unit="" />
            <CompareChart title="Viscosity Comparison (cP)" samples={activeSamples} dataKey="visc" unit="cP" />
          </div>
        </div>
      )}
    </div>
  )
}
