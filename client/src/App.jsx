import { useState, useEffect } from 'react'
import { Routes, Route, Link, useLocation, Navigate, useNavigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import SampleDetail from './pages/SampleDetail'
import Formulations from './pages/Formulations'
import FormulationSheet from './pages/FormulationSheet'
import AdminPanel from './pages/AdminPanel'
import LoginPage from './pages/LoginPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ComparisonPage from './pages/ComparisonPage'
import { getMe, logout, getSamples } from './api'

const TP_DAYS = { Initial: 0, '2_weeks': 14, '1_month': 30, '2_months': 60, '3_months': 90 }
const TIME_POINTS = ['Initial', '2_weeks', '1_month', '2_months', '3_months']
const TIME_LABELS = { Initial: 'Initial', '2_weeks': '2 Weeks', '1_month': '1 Month', '2_months': '2 Months', '3_months': '3 Months' }

function getAlerts(samples) {
  const alerts = []
  const today = new Date(); today.setHours(0, 0, 0, 0)
  for (const s of samples) {
    if ((s.status || 'active') !== 'active' || !s.date_started) continue
    const start = new Date(s.date_started)
    const done = new Set(s.time_points_done || [])
    for (const tp of TIME_POINTS) {
      if (done.has(tp)) continue
      const due = new Date(start); due.setDate(due.getDate() + TP_DAYS[tp])
      const diff = Math.ceil((due - today) / 86400000)
      if (diff < 0) alerts.push({ type: 'overdue', sample: s, tp, diff })
      else if (diff <= 7) alerts.push({ type: 'soon', sample: s, tp, diff })
    }
  }
  return alerts
}

function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [alerts, setAlerts] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    getSamples().then(s => setAlerts(getAlerts(s))).catch(() => {})
  }, [])

  const overdueCount = alerts.filter(a => a.type === 'overdue').length
  const count = alerts.length

  if (count === 0) return null

  return (
    <div className="relative">
      <button
        className="relative p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-lg">🔔</span>
        <span className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] text-[10px] font-bold text-white rounded-full flex items-center justify-center px-1 ${overdueCount > 0 ? 'bg-red-500' : 'bg-amber-500'}`}>
          {count}
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">{count} Alert{count !== 1 ? 's' : ''}</p>
              <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
              {alerts.map((a, i) => (
                <div key={i}
                  className="px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => { navigate(`/samples/${a.sample.id}`); setOpen(false) }}>
                  <p className="text-xs font-medium text-gray-800 truncate">{a.sample.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {TIME_LABELS[a.tp]} —
                    {a.type === 'overdue'
                      ? <span className="text-red-600 font-medium"> Overdue ({Math.abs(a.diff)}d ago)</span>
                      : <span className="text-amber-600 font-medium"> Due in {a.diff}d</span>}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Navbar({ user, onLogout }) {
  const loc = useLocation()
  const isForm = loc.pathname.startsWith('/formulations')
  const isAdmin = loc.pathname.startsWith('/admin')
  const isCompare = loc.pathname.startsWith('/compare')

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40 no-print">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link to="/" className="flex items-center gap-2 font-semibold text-gray-900 hover:text-blue-600 transition-colors shrink-0">
            <span className="text-xl">🧪</span>
            <span className="hidden sm:inline">FormuLab Hub</span>
          </Link>
          <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
            <Link to="/" className={`px-2.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${!isForm && !isAdmin && !isCompare ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              Stability
            </Link>
            <Link to="/formulations" className={`px-2.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${isForm ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              Formulations
            </Link>
            <Link to="/compare" className={`px-2.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${isCompare ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              Compare
            </Link>
            {user?.role === 'admin' && (
              <Link to="/admin" className={`px-2.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${isAdmin ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-100'}`}>
                Admin
              </Link>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <NotificationBell />
            <div className="flex items-center gap-1.5">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${user?.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'}`}>
                {user?.username?.[0]?.toUpperCase()}
              </div>
              <div className="hidden md:block text-right">
                <p className="text-xs font-medium text-gray-800 leading-none">{user?.username}</p>
                <p className="text-xs text-gray-400 capitalize leading-none mt-0.5">{user?.role}</p>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const loc = useLocation()

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false))
  }, [])

  async function handleLogout() {
    try { await logout() } catch {}
    setUser(null)
  }

  if (loc.pathname === '/reset-password') {
    return <ResetPasswordPage />
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <span className="text-4xl">🧪</span>
          <p className="text-gray-400 text-sm mt-3">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />
  }

  return (
    <div className="min-h-screen">
      <Navbar user={user} onLogout={handleLogout} />
      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/samples/:id" element={<SampleDetail />} />
          <Route path="/formulations" element={<Formulations />} />
          <Route path="/formulations/:id" element={<FormulationSheet />} />
          <Route path="/compare" element={<ComparisonPage />} />
          <Route path="/admin" element={
            user.role === 'admin'
              ? <AdminPanel currentUser={user} />
              : <Navigate to="/" replace />
          } />
        </Routes>
      </main>
    </div>
  )
}
