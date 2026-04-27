import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFormulations, createFormulation, deleteFormulation } from '../api'

export default function Formulations() {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    getFormulations().then(setList).finally(() => setLoading(false))
  }, [])

  async function handleNew() {
    const f = await createFormulation({
      product_name: 'New Formulation',
      ingredients: [{ id: 1, part: 'A', trade_name: '', inci_name: '', percent: '', supplier: '', function: '' }],
      procedure: [{ id: 1, text: '' }],
      specifications: [
        { id: 1, property: 'Appearance', value: '' },
        { id: 2, property: 'Viscosity', value: '' },
        { id: 3, property: 'pH', value: '' },
      ],
    })
    navigate(`/formulations/${f.id}`)
  }

  async function handleDelete(e, id, name) {
    e.stopPropagation()
    if (!confirm(`Delete "${name}"?`)) return
    await deleteFormulation(id)
    setList(prev => prev.filter(x => x.id !== id))
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Formulation Sheets</h1>
          <p className="text-sm text-gray-500 mt-1">Product formulas with ingredients, procedure and specifications</p>
        </div>
        <button className="btn-primary" onClick={handleNew}>+ New Formulation</button>
      </div>

      {list.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-3">🧴</p>
          <p className="text-gray-500 font-medium">No formulations yet</p>
          <p className="text-sm text-gray-400 mt-1">Click "+ New Formulation" to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map(f => (
            <div key={f.id} className="card p-5 cursor-pointer hover:shadow-md hover:border-blue-200 transition-all group"
              onClick={() => navigate(`/formulations/${f.id}`)}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate group-hover:text-blue-700">{f.product_name || 'Untitled'}</h3>
                  {f.ref_no && <p className="text-xs font-mono text-gray-400 mt-0.5">{f.ref_no}</p>}
                  {f.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{f.description}</p>}
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
                <span>🧪 {(f.ingredients || []).length} ingredients</span>
                <span>📋 {(f.procedure || []).length} steps</span>
                <span>📅 {f.created_at?.slice(0, 10)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-blue-600 group-hover:underline">Open →</span>
                <button className="btn-danger text-xs py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={e => handleDelete(e, f.id, f.product_name)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
