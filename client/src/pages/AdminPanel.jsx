import { useState, useEffect, useRef } from 'react'
import { getUsers, createUser, updateUser, deleteUser, getAuditLog, changePassword, exportBackup, importBackup, getAdminResetLink } from '../api'

const ACTION_LABELS = {
  login: { label: 'Login', color: 'text-green-700 bg-green-50' },
  login_fail: { label: 'Failed login', color: 'text-red-700 bg-red-50' },
  logout: { label: 'Logout', color: 'text-gray-600 bg-gray-100' },
  user_created: { label: 'User created', color: 'text-blue-700 bg-blue-50' },
  user_updated: { label: 'User updated', color: 'text-amber-700 bg-amber-50' },
  user_deleted: { label: 'User deleted', color: 'text-red-700 bg-red-50' },
  password_changed: { label: 'Password changed', color: 'text-purple-700 bg-purple-50' },
  backup_restored: { label: 'Backup restored', color: 'text-orange-700 bg-orange-50' },
}

function Badge({ action }) {
  const cfg = ACTION_LABELS[action] || { label: action, color: 'text-gray-600 bg-gray-100' }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>
}

// ── User Modal ────────────────────────────────────────────────────────────────

function UserModal({ user, onClose, onSave }) {
  const isEdit = !!user
  const [form, setForm] = useState({
    username: user?.username || '',
    email: user?.email || '',
    role: user?.role || 'user',
    is_active: user?.is_active !== false,
    password: '',
    confirm: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    if (!form.username.trim()) return setError('Username is required')
    if (!isEdit && !form.password) return setError('Password is required')
    if (form.password && form.password !== form.confirm) return setError('Passwords do not match')
    if (form.password && form.password.length < 6) return setError('Password must be at least 6 characters')
    setSaving(true); setError('')
    try {
      const payload = { username: form.username, email: form.email, role: form.role, is_active: form.is_active }
      if (form.password) payload.password = form.password
      await onSave(payload)
      onClose()
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to save')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold">{isEdit ? 'Edit User' : 'Add User'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">Username *</label>
              <input className="input" value={form.username} onChange={e => set('username', e.target.value)} placeholder="username" />
            </div>
            <div className="col-span-2">
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="user@company.com" />
            </div>
            <div>
              <label className="label">Role</label>
              <select className="input" value={form.role} onChange={e => set('role', e.target.value)}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.is_active ? 'active' : 'inactive'} onChange={e => set('is_active', e.target.value === 'active')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className="label">{isEdit ? 'New Password' : 'Password *'}</label>
              <input className="input" type="password" value={form.password} onChange={e => set('password', e.target.value)}
                placeholder={isEdit ? 'Leave blank to keep' : 'Min 6 chars'} />
            </div>
            <div>
              <label className="label">Confirm Password</label>
              <input className="input" type="password" value={form.confirm} onChange={e => set('confirm', e.target.value)} placeholder="Repeat password" />
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? 'Saving...' : isEdit ? 'Update User' : 'Create User'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Change Password Modal ─────────────────────────────────────────────────────

function ChangePasswordModal({ onClose }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    if (form.next !== form.confirm) return setError('Passwords do not match')
    if (form.next.length < 6) return setError('New password must be at least 6 characters')
    setSaving(true); setError('')
    try {
      await changePassword(form.current, form.next)
      setDone(true)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to change password')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold">Change Password</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        {done ? (
          <div className="p-6 text-center">
            <p className="text-2xl mb-2">✅</p>
            <p className="text-gray-700 font-medium">Password changed successfully</p>
            <button className="btn-primary mt-4 w-full" onClick={onClose}>Close</button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <div><label className="label">Current Password</label>
              <input className="input" type="password" value={form.current} onChange={e => set('current', e.target.value)} /></div>
            <div><label className="label">New Password</label>
              <input className="input" type="password" value={form.next} onChange={e => set('next', e.target.value)} placeholder="Min 6 characters" /></div>
            <div><label className="label">Confirm New Password</label>
              <input className="input" type="password" value={form.confirm} onChange={e => set('confirm', e.target.value)} /></div>
            <div className="flex gap-3 pt-1">
              <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? 'Saving...' : 'Change Password'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Main Admin Panel ──────────────────────────────────────────────────────────

export default function AdminPanel({ currentUser }) {
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState([])
  const [auditLog, setAuditLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [userModal, setUserModal] = useState(null)
  const [changePwModal, setChangePwModal] = useState(false)
  const [backupWorking, setBackupWorking] = useState(false)
  const [backupMsg, setBackupMsg] = useState(null)
  const [resetLink, setResetLink] = useState(null)
  const restoreInputRef = useRef()

  useEffect(() => {
    Promise.all([getUsers(), getAuditLog()])
      .then(([u, a]) => { setUsers(u); setAuditLog(a) })
      .finally(() => setLoading(false))
  }, [])

  async function handleSaveUser(payload) {
    if (userModal?.id) {
      const updated = await updateUser(userModal.id, payload)
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u))
    } else {
      const created = await createUser(payload)
      setUsers(prev => [...prev, created])
    }
    const log = await getAuditLog()
    setAuditLog(log)
  }

  async function handleGetResetLink(user) {
    try {
      const data = await getAdminResetLink(user.id)
      setResetLink({ username: user.username, url: data.url })
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to generate reset link')
    }
  }

  async function handleDelete(user) {
    if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return
    await deleteUser(user.id)
    setUsers(prev => prev.filter(u => u.id !== user.id))
    const log = await getAuditLog()
    setAuditLog(log)
  }

  async function handleExport() {
    setBackupWorking(true); setBackupMsg(null)
    try {
      const blob = await exportBackup()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `formulab-backup-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
      setBackupMsg({ ok: true, text: 'Backup downloaded successfully (includes all images).' })
    } catch {
      setBackupMsg({ ok: false, text: 'Export failed. Please try again.' })
    } finally { setBackupWorking(false) }
  }

  async function handleRestore(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (!confirm(`Restore from "${file.name}"?\n\nThis will REPLACE all current data (samples, formulations, users). This cannot be undone.`)) return
    setBackupWorking(true); setBackupMsg(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const result = await importBackup(formData)
      setBackupMsg({ ok: true, text: `Restored: ${result.stats.samples} samples, ${result.stats.formulations} formulations, ${result.stats.users} users.` })
      const [u, a] = await Promise.all([getUsers(), getAuditLog()])
      setUsers(u); setAuditLog(a)
    } catch (err) {
      setBackupMsg({ ok: false, text: err?.response?.data?.error || 'Restore failed. Check the file and try again.' })
    } finally { setBackupWorking(false) }
  }

  const totalUsers = users.length
  const admins = users.filter(u => u.role === 'admin').length
  const active = users.filter(u => u.is_active).length
  const recentLogins = auditLog.filter(e => e.action === 'login').slice(0, 5)

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>

  return (
    <>
      {userModal !== null && (
        <UserModal
          user={userModal?.id ? userModal : null}
          onClose={() => setUserModal(null)}
          onSave={handleSaveUser}
        />
      )}
      {changePwModal && <ChangePasswordModal onClose={() => setChangePwModal(false)} />}

      {resetLink && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setResetLink(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">Password Reset Link — {resetLink.username}</h2>
              <button onClick={() => setResetLink(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-500">Copy this link and send it to the user. It expires in <strong>1 hour</strong>.</p>
              <div className="flex gap-2">
                <input readOnly value={resetLink.url} className="input flex-1 text-xs font-mono bg-gray-50 select-all" onClick={e => e.target.select()} />
                <button className="btn-primary text-sm whitespace-nowrap" onClick={() => { navigator.clipboard.writeText(resetLink.url); alert('Copied!') }}>Copy</button>
              </div>
              <p className="text-xs text-amber-600">Keep this link private — anyone with it can reset the password.</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
          <p className="text-sm text-gray-500 mt-1">Manage users and monitor system activity</p>
        </div>
        <button className="btn-secondary text-sm" onClick={() => setChangePwModal(true)}>🔑 Change My Password</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Users', value: totalUsers, icon: '👥', color: 'bg-blue-50 text-blue-700' },
          { label: 'Admins', value: admins, icon: '🛡', color: 'bg-purple-50 text-purple-700' },
          { label: 'Active Users', value: active, icon: '✅', color: 'bg-green-50 text-green-700' },
          { label: 'Inactive', value: totalUsers - active, icon: '🔒', color: 'bg-gray-50 text-gray-600' },
        ].map(s => (
          <div key={s.label} className={`card p-4 flex items-center gap-3 ${s.color}`}>
            <span className="text-2xl">{s.icon}</span>
            <div>
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs font-medium opacity-80">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit">
        {[
          { key: 'users', label: '👥 Users' },
          { key: 'activity', label: '📋 Activity Log' },
          { key: 'backup', label: '💾 Backup' },
        ].map(t => (
          <button key={t.key}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t.key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'users' && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">User Accounts</h3>
            <button className="btn-primary text-sm" onClick={() => setUserModal({})}>+ Add User</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 font-semibold uppercase tracking-wide">
                  <th className="px-4 py-3">Username</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last Login</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {u.username}
                      {u.id === currentUser.id && <span className="ml-2 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">You</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{u.email || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{u.last_login || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{u.created_at?.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button className="btn-secondary text-xs py-1 px-2" onClick={() => setUserModal(u)}>Edit</button>
                        <button className="text-xs py-1 px-2 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors" onClick={() => handleGetResetLink(u)}>Reset Link</button>
                        {u.id !== currentUser.id && (
                          <button className="btn-danger text-xs py-1 px-2" onClick={() => handleDelete(u)}>Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'backup' && (
        <div className="card p-6 max-w-xl space-y-6">
          <div>
            <h3 className="font-semibold text-gray-900 mb-1">Export Backup</h3>
            <p className="text-sm text-gray-500 mb-3">Download all samples, formulations, user accounts, and uploaded images as a ZIP file. Save this before migrating to a new server.</p>
            <button className="btn-primary" onClick={handleExport} disabled={backupWorking}>
              {backupWorking ? 'Working...' : '⬇ Download Backup (.zip)'}
            </button>
          </div>
          <hr className="border-gray-200" />
          <div>
            <h3 className="font-semibold text-gray-900 mb-1">Restore from Backup</h3>
            <p className="text-sm text-gray-500 mb-3">Upload a previously exported backup file to restore all data. This will <strong>replace</strong> all current data.</p>
            <input ref={restoreInputRef} type="file" accept=".json,.zip" className="hidden" onChange={handleRestore} />
            <button className="btn-danger" onClick={() => restoreInputRef.current.click()} disabled={backupWorking}>
              ⬆ Restore from File
            </button>
          </div>
          {backupMsg && (
            <div className={`text-sm px-4 py-3 rounded-xl ${backupMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {backupMsg.ok ? '✅ ' : '⚠ '}{backupMsg.text}
            </div>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Activity Log <span className="text-xs font-normal text-gray-400 ml-1">(last 200 events)</span></h3>
          </div>
          {auditLog.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-sm">No activity recorded yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500 font-semibold uppercase tracking-wide">
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">IP Address</th>
                    <th className="px-4 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditLog.map(e => (
                    <tr key={e.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{e.created_at}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{e.username}</td>
                      <td className="px-4 py-2.5"><Badge action={e.action} /></td>
                      <td className="px-4 py-2.5 text-xs text-gray-400 font-mono">{e.ip || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{e.details || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
}
