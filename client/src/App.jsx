import { Routes, Route, Link, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import SampleDetail from './pages/SampleDetail'
import Formulations from './pages/Formulations'
import FormulationSheet from './pages/FormulationSheet'

function Navbar() {
  const loc = useLocation()
  const isForm = loc.pathname.startsWith('/formulations')
  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40 no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link to="/" className="flex items-center gap-2.5 font-semibold text-gray-900 hover:text-blue-600 transition-colors">
            <span className="text-xl">🧪</span>
            <span>Stability Test Manager</span>
          </Link>
          <div className="flex items-center gap-1">
            <Link to="/" className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${!isForm ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              Stability Tests
            </Link>
            <Link to="/formulations" className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isForm ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              Formulations
            </Link>
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
          <Route path="/formulations" element={<Formulations />} />
          <Route path="/formulations/:id" element={<FormulationSheet />} />
        </Routes>
      </main>
    </div>
  )
}
