import { useState, useEffect } from 'react'

const TIME_LABELS = {
  Initial: 'Initial', '2_weeks': '2 Weeks', '1_month': '1 Month',
  '2_months': '2 Months', '3_months': '3 Months',
}
const SUFFIXES = ['25', '45', '50']

function NumInput({ label, value, onChange }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type="number" step="0.01" className="input" value={value}
        onChange={e => onChange(e.target.value)} placeholder="0.00" />
    </div>
  )
}

export default function DataEntryModal({ timePoint, existing, temps, onSave, onClose }) {
  const [form, setForm] = useState({
    ph_25: '', viscosity_25: '', ph_45: '', viscosity_45: '',
    ph_50: '', viscosity_50: '', spindle: '', rpm: '', notes: '',
    measured_at: new Date().toISOString().split('T')[0],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (existing) {
      setForm({
        ph_25: existing.ph_25 ?? '', viscosity_25: existing.viscosity_25 ?? '',
        ph_45: existing.ph_45 ?? '', viscosity_45: existing.viscosity_45 ?? '',
        ph_50: existing.ph_50 ?? '', viscosity_50: existing.viscosity_50 ?? '',
        spindle: existing.spindle || '', rpm: existing.rpm ?? '',
        notes: existing.notes || '',
        measured_at: existing.measured_at || new Date().toISOString().split('T')[0],
      })
    }
  }, [existing])

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try { await onSave({ time_point: timePoint, ...form }); onClose() }
    catch (err) { setError(err?.response?.data?.error || 'Failed to save.'); setSaving(false) }
  }

  const TEMP_COLORS = [
    { bg: 'bg-blue-50/60', border: 'border-blue-100', label: 'text-blue-700' },
    { bg: 'bg-amber-50/60', border: 'border-amber-100', label: 'text-amber-700' },
    { bg: 'bg-red-50/60', border: 'border-red-100', label: 'text-red-700' },
  ]

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Enter Measurements</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Time point: <span className="font-medium text-blue-600">{TIME_LABELS[timePoint] || timePoint}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          {(temps || []).map((t, i) => {
            const suf = SUFFIXES[i]
            const isNA = (t.na_tps || []).includes(timePoint)
            const c = TEMP_COLORS[i] || TEMP_COLORS[0]
            return (
              <div key={i} className={`rounded-xl border p-3 ${c.bg} ${c.border}`}>
                <p className={`text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-2 ${c.label}`}>
                  {t.value}°C
                  {isNA && <span className="text-xs font-normal text-gray-400 normal-case">(N/A for this time point)</span>}
                </p>
                {isNA ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="h-9 bg-gray-100 rounded-lg flex items-center justify-center text-xs text-gray-400">N/A</div>
                    <div className="h-9 bg-gray-100 rounded-lg flex items-center justify-center text-xs text-gray-400">N/A</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <NumInput label="pH" value={form[`ph_${suf}`]} onChange={v => set(`ph_${suf}`, v)} />
                    <NumInput label="Viscosity (cP)" value={form[`viscosity_${suf}`]} onChange={v => set(`viscosity_${suf}`, v)} />
                  </div>
                )}
              </div>
            )
          })}

          <div className="rounded-xl border border-gray-200 p-3 bg-gray-50/50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Viscometer Settings</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Spindle #</label>
                <input className="input" value={form.spindle}
                  onChange={e => set('spindle', e.target.value)} placeholder="e.g. SC4-25" />
              </div>
              <div>
                <label className="label">RPM</label>
                <input type="number" step="0.1" className="input" value={form.rpm}
                  onChange={e => set('rpm', e.target.value)} placeholder="e.g. 10" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Measurement Date</label>
              <input type="date" className="input" value={form.measured_at}
                onChange={e => set('measured_at', e.target.value)} />
            </div>
            <div>
              <label className="label">Notes</label>
              <input className="input" value={form.notes}
                onChange={e => set('notes', e.target.value)} placeholder="Optional notes..." />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={saving}>
              {saving ? 'Saving...' : existing ? 'Update' : 'Save Measurements'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
