import { Routes, Route, Link, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import SampleDetail from './pages/SampleDetail'

function Navbar() {
  const loc = useLocation()
  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40 no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link to="/" className="flex items-center gap-2.5 font-semibold text-gray-900 hover:text-blue-600 transition-colors">
            <span className="text-xl">🧪</span>
            <span>Stability Test Manager</span>
          </Link>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span className="hidden sm:block">Quality Lab System</span>
            {loc.pathname !== '/' && (
              <Link to="/" className="btn-secondary text-xs py-1">
                ← Dashboard
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/samples/:id" element={<SampleDetail />} />
        </Routes>
      </main>
    </div>
  )
}
