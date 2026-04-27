import axios from 'axios'

const api = axios.create({ baseURL: '/api', withCredentials: true })

// ── Auth ───────────────────────────────────────────────────────────────────────

export const getMe = () =>
  api.get('/auth/me').then(r => r.data)

export const login = (username, password) =>
  api.post('/auth/login', { username, password }).then(r => r.data)

export const logout = () =>
  api.post('/auth/logout').then(r => r.data)

export const changePassword = (current_password, new_password) =>
  api.put('/auth/password', { current_password, new_password }).then(r => r.data)

// ── User Management ───────────────────────────────────────────────────────────

export const getUsers = () =>
  api.get('/users').then(r => r.data)

export const createUser = data =>
  api.post('/users', data).then(r => r.data)

export const updateUser = (id, data) =>
  api.put(`/users/${id}`, data).then(r => r.data)

export const deleteUser = id =>
  api.delete(`/users/${id}`).then(r => r.data)

export const getAuditLog = () =>
  api.get('/audit-log').then(r => r.data)

export const getSamples = (search = '') =>
  api.get('/samples', { params: search ? { search } : {} }).then(r => r.data)

export const getSample = id =>
  api.get(`/samples/${id}`).then(r => r.data)

export const createSample = data =>
  api.post('/samples', data).then(r => r.data)

export const updateSample = (id, data) =>
  api.put(`/samples/${id}`, data).then(r => r.data)

export const deleteSample = id =>
  api.delete(`/samples/${id}`).then(r => r.data)

export const upsertResult = (sampleId, data) =>
  api.post(`/samples/${sampleId}/results`, data).then(r => r.data)

export const deleteResult = id =>
  api.delete(`/results/${id}`).then(r => r.data)

export const uploadImage = (sampleId, file, caption = '') => {
  const fd = new FormData()
  fd.append('image', file)
  fd.append('caption', caption)
  return api.post(`/samples/${sampleId}/images`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }).then(r => r.data)
}

export const updateImageCaption = (id, caption) =>
  api.put(`/images/${id}`, { caption }).then(r => r.data)

export const deleteImage = id =>
  api.delete(`/images/${id}`).then(r => r.data)

// ── Formulations ──────────────────────────────────────────────────────────────

export const getFormulations = () =>
  api.get('/formulations').then(r => r.data)

export const getFormulation = id =>
  api.get(`/formulations/${id}`).then(r => r.data)

export const createFormulation = data =>
  api.post('/formulations', data).then(r => r.data)

export const updateFormulation = (id, data) =>
  api.put(`/formulations/${id}`, data).then(r => r.data)

export const deleteFormulation = id =>
  api.delete(`/formulations/${id}`).then(r => r.data)

export const uploadLogo = (id, file) => {
  const fd = new FormData(); fd.append('image', file)
  return api.post(`/formulations/${id}/logo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
}

export const uploadRefImage = (id, file) => {
  const fd = new FormData(); fd.append('image', file)
  return api.post(`/formulations/${id}/refimage`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
}
