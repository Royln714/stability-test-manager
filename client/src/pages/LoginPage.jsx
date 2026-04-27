import { useState } from 'react'
import { login, forgotPassword } from '../api'

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState('login') // 'login' | 'forgot' | 'sent'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    if (!username.trim() || !password) return
    setLoading(true); setError('')
    try {
      const user = await login(username.trim(), password)
      onLogin(user)
    } catch (err) {
      setError(err?.response?.data?.error || 'Login failed. Please try again.')
    } finally { setLoading(false) }
  }

  async function handleForgot(e) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true); setError('')
    try {
      await forgotPassword(email.trim())
      setMode('sent')
    } catch (err) {
      setError(err?.response?.data?.error || 'Something went wrong. Please try again.')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl shadow-lg mb-4">
            <span className="text-3xl">🧪</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">FormuLab Hub</h1>
          <p className="text-sm text-gray-500 mt-1">
            {mode === 'login' ? 'Sign in to continue' : mode === 'forgot' ? 'Reset your password' : 'Check your email'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">

          {/* ── Login form ── */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-5">
              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
                  <span>⚠</span> {error}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Username</label>
                <input
                  autoFocus
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  placeholder="Enter username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition pr-10"
                    placeholder="Enter password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                  <button type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                    onClick={() => setShowPw(p => !p)} tabIndex={-1}>
                    {showPw ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading || !username.trim() || !password}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-xl text-sm transition-colors shadow-sm"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
              <div className="text-center">
                <button type="button"
                  className="text-xs text-blue-600 hover:underline"
                  onClick={() => { setMode('forgot'); setError('') }}>
                  Forgot password?
                </button>
              </div>
            </form>
          )}

          {/* ── Forgot password form ── */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-5">
              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
                  <span>⚠</span> {error}
                </div>
              )}
              <p className="text-sm text-gray-500">
                Enter your account's email address and we'll send you a password reset link.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
                <input
                  autoFocus
                  type="email"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  placeholder="your@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-xl text-sm transition-colors shadow-sm"
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
              <div className="text-center">
                <button type="button"
                  className="text-xs text-gray-500 hover:underline"
                  onClick={() => { setMode('login'); setError('') }}>
                  ← Back to sign in
                </button>
              </div>
            </form>
          )}

          {/* ── Sent confirmation ── */}
          {mode === 'sent' && (
            <div className="text-center space-y-4">
              <div className="text-5xl">📧</div>
              <h3 className="font-semibold text-gray-900">Check your inbox</h3>
              <p className="text-sm text-gray-500">
                If <strong>{email}</strong> is registered, a password reset link has been sent. Check your spam folder if you don't see it.
              </p>
              <p className="text-xs text-gray-400">The link expires in 1 hour.</p>
              <button
                className="w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-sm transition-colors mt-2"
                onClick={() => { setMode('login'); setEmail(''); setError('') }}>
                ← Back to sign in
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          ET · FormuLab Hub
        </p>
      </div>
    </div>
  )
}
