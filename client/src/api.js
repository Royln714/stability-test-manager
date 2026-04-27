import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

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
