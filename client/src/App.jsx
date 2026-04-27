import { useState, useEffect } from 'react'
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import SampleDetail from './pages/SampleDetail'
import Formulations from './pages/Formulations'
import FormulationSheet from './pages/FormulationSheet'
import AdminPanel from './pages/AdminPanel'
import LoginPage from './pages/LoginPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import { getMe, logout } from './api'

function Navbar({ user, onLogout }) {
  const loc = useLocation()
  const isForm = loc.pathname.startsWith('/formulations')
  const isAdmin = loc.pathname.startsWith('/admin')

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40 no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link to="/" className="flex items-center gap-2.5 font-semibold text-gray-900 hover:text-blue-600 transition-colors">
            <span className="text-xl">🧪</span>
            <span>FormuLab Hub</span>
          </Link>
          <div className="flex items-center gap-1">
            <Link to="/" className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${!isForm && !isAdmin ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              Stability Tests
            </Link>
            <Link to="/formulations" className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isForm ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              Formulations
            </Link>
            {user?.role === 'admin' && (
              <Link to="/admin" className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isAdmin ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-100'}`}>
                Admin
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${user?.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'}`}>
                {user?.username?.[0]?.toUpperCase()}
              </div>
              <div className="hidden sm:block text-right">
                <p className="text-xs font-medium text-gray-800 leading-none">{user?.username}</p>
                <p className="text-xs text-gray-400 capitalize leading-none mt-0.5">{user?.role}</p>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors"
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/samples/:id" element={<SampleDetail />} />
          <Route path="/formulations" element={<Formulations />} />
          <Route path="/formulations/:id" element={<FormulationSheet />} />
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
