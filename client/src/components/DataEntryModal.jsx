import { useState, useEffect } from 'react'

const TIME_LABELS = {
  Initial: 'Initial',
  '2_weeks': '2 Weeks',
  '1_month': '1 Month',
  '2_months': '2 Months',
  '3_months': '3 Months',
}

// Grey-out (N/A) matrix matching the original template
const NA_CELLS = {
  45: ['Initial'],
  50: ['Initial', '2_weeks'],
}

function isNA(temp, timePoint) {
  return (NA_CELLS[temp] || []).includes(timePoint)
}

function NumInput({ label, value, onChange, placeholder = '0.00' }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        step="0.01"
        className="input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

export default function DataEntryModal({ sampleId, timePoint, existing, onSave, onClose }) {
  const [form, setForm] = useState({
    ph_25: '', viscosity_25: '',
    ph_45: '', viscosity_45: '',
    ph_50: '', viscosity_50: '',
    notes: '',
    measured_at: new Date().toISOString().split('T')[0],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (existing) {
      setForm({
        ph_25: existing.ph_25 ?? '',
        viscosity_25: existing.viscosity_25 ?? '',
        ph_45: existing.ph_45 ?? '',
        viscosity_45: existing.viscosity_45 ?? '',
        ph_50: existing.ph_50 ?? '',
        viscosity_50: existing.viscosity_50 ?? '',
        notes: existing.notes || '',
        measured_at: existing.measured_at || new Date().toISOString().split('T')[0],
      })
    }
  }, [existing])

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({ time_point: timePoint, ...form })
      onClose()
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to save. Please try again.')
      setSaving(false)
    }
  }

  const label = TIME_LABELS[timePoint] || timePoint

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Enter Measurements</h2>
              <p className="text-sm text-gray-500 mt-0.5">Time point: <span className="font-medium text-blue-600">{label}</span></p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
          </div>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          {/* 25°C */}
          <div>
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">25°C — Room Temperature</p>
            <div className="grid grid-cols-2 gap-3">
              <NumInput label="pH" value={form.ph_25} onChange={v => set('ph_25', v)} />
              <NumInput label="Viscosity (cP)" value={form.viscosity_25} onChange={v => set('viscosity_25', v)} />
            </div>
          </div>

          {/* 45°C */}
          <div>
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-2">
              45°C — Accelerated
              {isNA(45, timePoint) && <span className="text-xs font-normal text-gray-400 normal-case">(N/A for this time point)</span>}
            </p>
            {isNA(45, timePoint) ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="h-9 bg-gray-100 rounded-lg flex items-center justify-center text-xs text-gray-400">N/A</div>
                <div className="h-9 bg-gray-100 rounded-lg flex items-center justify-center text-xs text-gray-400">N/A</div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <NumInput label="pH" value={form.ph_45} onChange={v => set('ph_45', v)} />
                <NumInput label="Viscosity (cP)" value={form.viscosity_45} onChange={v => set('viscosity_45', v)} />
              </div>
            )}
          </div>

          {/* 50°C */}
          <div>
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-2">
              50°C — Stress
              {isNA(50, timePoint) && <span className="text-xs font-normal text-gray-400 normal-case">(N/A for this time point)</span>}
            </p>
            {isNA(50, timePoint) ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="h-9 bg-gray-100 rounded-lg flex items-center justify-center text-xs text-gray-400">N/A</div>
                <div className="h-9 bg-gray-100 rounded-lg flex items-center justify-center text-xs text-gray-400">N/A</div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <NumInput label="pH" value={form.ph_50} onChange={v => set('ph_50', v)} />
                <NumInput label="Viscosity (cP)" value={form.viscosity_50} onChange={v => set('viscosity_50', v)} />
              </div>
            )}
          </div>

          {/* Meta */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Measurement Date</label>
              <input type="date" className="input" value={form.measured_at} onChange={e => set('measured_at', e.target.value)} />
            </div>
            <div>
              <label className="label">Notes</label>
              <input className="input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional..." />
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
