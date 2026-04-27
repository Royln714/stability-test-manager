import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSamples, createSample, deleteSample } from '../api'

const TIME_POINTS = ['Initial', '2 Weeks', '1 Month', '2 Months', '3 Months']
const TOTAL_POINTS = 5

function SampleFormModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ name: '', ref_no: '', date_started: new Date().toISOString().split('T')[0], remarks: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handle = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Sample name is required'); return }
    setSaving(true)
    try {
      const s = await createSample(form)
      onCreate(s)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create sample')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">New Stability Test Sample</h2>
          <p className="text-sm text-gray-500 mt-1">Enter sample details to begin tracking</p>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <div>
            <label className="label">Sample Name <span className="text-red-500">*</span></label>
            <input className="input" name="name" value={form.name} onChange={handle} placeholder="e.g. Face Cream SPF50" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Ref No</label>
              <input className="input" name="ref_no" value={form.ref_no} onChange={handle} placeholder="FC-2024-001" />
            </div>
            <div>
              <label className="label">Date Started</label>
              <input className="input" type="date" name="date_started" value={form.date_started} onChange={handle} />
            </div>
          </div>
          <div>
            <label className="label">Remarks</label>
            <textarea className="input resize-none" name="remarks" value={form.remarks} onChange={handle} rows={2} placeholder="Optional notes..." />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={saving}>
              {saving ? 'Creating...' : '+ Create Sample'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ProgressBar({ completed, total }) {
  const pct = Math.round((completed / total) * 100)
  const color = pct === 100 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : pct >= 20 ? 'bg-amber-500' : 'bg-gray-300'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>{completed}/{total} time points</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function SampleCard({ sample, onDelete, onClick }) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(e) {
    e.stopPropagation()
    if (!confirm(`Delete "${sample.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try { await deleteSample(sample.id); onDelete(sample.id) }
    catch { setDeleting(false) }
  }

  const badge = sample.completed_points === TOTAL_POINTS
    ? { label: 'Complete', cls: 'bg-green-100 text-green-700' }
    : sample.completed_points === 0
    ? { label: 'Pending', cls: 'bg-gray-100 text-gray-600' }
    : { label: 'In Progress', cls: 'bg-blue-100 text-blue-700' }

  return (
    <div
      className="card p-5 cursor-pointer hover:shadow-md hover:border-blue-200 transition-all group"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate group-hover:text-blue-700 transition-colors">{sample.name}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {sample.ref_no && <span className="mr-2 font-mono">{sample.ref_no}</span>}
            {sample.date_started && <span>{sample.date_started}</span>}
          </p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ml-2 shrink-0 ${badge.cls}`}>{badge.label}</span>
      </div>

      <ProgressBar completed={sample.completed_points} total={TOTAL_POINTS} />

      <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
        <span>📸 {sample.image_count} image{sample.image_count !== 1 ? 's' : ''}</span>
        {sample.remarks && <span className="truncate text-gray-400 flex-1" title={sample.remarks}>"{sample.remarks}"</span>}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-blue-600 group-hover:underline">View details →</span>
        <button
          className="btn-danger text-xs py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleDelete}
          disabled={deleting}
        >
          {deleting ? '...' : 'Delete'}
        </button>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [samples, setSamples] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try { setSamples(await getSamples(search)) }
    finally { setLoading(false) }
  }, [search])

  useEffect(() => { load() }, [load])

  const stats = {
    total: samples.length,
    complete: samples.filter(s => s.completed_points === TOTAL_POINTS).length,
    inProgress: samples.filter(s => s.completed_points > 0 && s.completed_points < TOTAL_POINTS).length,
  }

  return (
    <>
      {showForm && (
        <SampleFormModal
          onClose={() => setShowForm(false)}
          onCreate={s => { setSamples(prev => [s, ...prev]); setShowForm(false); navigate(`/samples/${s.id}`) }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stability Tests</h1>
          <p className="text-sm text-gray-500 mt-1">Track pH and viscosity across temperature conditions over time</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + New Sample
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Samples', value: stats.total, color: 'text-gray-900', bg: 'bg-white' },
          { label: 'In Progress', value: stats.inProgress, color: 'text-blue-700', bg: 'bg-blue-50' },
          { label: 'Completed', value: stats.complete, color: 'text-green-700', bg: 'bg-green-50' },
        ].map(s => (
          <div key={s.label} className={`card p-4 ${s.bg}`}>
            <p className="text-xs text-gray-500 uppercase tracking-wide">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="mb-5">
        <input
          className="input max-w-sm"
          placeholder="Search by name or ref no..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Sample grid */}
      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
      ) : samples.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-3">🧪</p>
          <p className="text-gray-500 font-medium">{search ? 'No samples match your search' : 'No samples yet'}</p>
          <p className="text-sm text-gray-400 mt-1">{!search && 'Click "+ New Sample" to get started'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {samples.map(s => (
            <SampleCard
              key={s.id}
              sample={s}
              onDelete={id => setSamples(prev => prev.filter(x => x.id !== id))}
              onClick={() => navigate(`/samples/${s.id}`)}
            />
          ))}
        </div>
      )}
    </>
  )
}
