'use client'

import { useState } from 'react'
import { createCategory } from '@/lib/actions/categories'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (id: string, name: string, emoji: string) => void
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 48, borderRadius: 12,
  border: '1px solid #2a2a2a', backgroundColor: '#1a1a1a',
  fontSize: 15, color: '#e5e5e5', padding: '0 14px', outline: 'none',
  boxSizing: 'border-box',
}

export function CreateCategoryDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  async function handleSubmit() {
    if (!name.trim() || !emoji.trim()) {
      setError('Nombre y emoji son requeridos')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.set('name', name.trim())
      formData.set('emoji', emoji.trim())
      const result = await createCategory(formData)
      if (result.success && result.categoryId) {
        onCreated(result.categoryId, name.trim(), emoji.trim())
        setName('')
        setEmoji('')
        onClose()
      } else {
        setError(result.error || 'Error al crear categoría')
      }
    } catch {
      setError('Ocurrió un error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
    }}>
      <div style={{
        backgroundColor: '#1a1a1a', borderRadius: 16, padding: 24,
        border: '1px solid #2a2a2a', maxWidth: 360, width: '100%',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#e5e5e5', marginBottom: 16 }}>
          Nueva Categoría
        </div>

        {error && (
          <div style={{
            backgroundColor: '#450a0a', border: '1px solid #7f1d1d',
            borderRadius: 8, padding: '8px 12px', marginBottom: 12,
            fontSize: 13, color: '#fca5a5',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 13, color: '#71717a', marginBottom: 6, display: 'block' }}>Emoji</label>
            <input
              value={emoji} onChange={e => setEmoji(e.target.value)}
              placeholder="🍕" autoFocus
              style={{ ...inputStyle, width: 80 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, color: '#71717a', marginBottom: 6, display: 'block' }}>Nombre</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder="Comida"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button onClick={() => { onClose(); setName(''); setEmoji(''); setError(null) }} style={{
            flex: 1, height: 44, borderRadius: 12, border: '1px solid #2a2a2a',
            backgroundColor: '#27272a', color: '#a1a1aa',
            fontSize: 15, fontWeight: 600, cursor: 'pointer',
          }}>
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={loading} style={{
            flex: 1, height: 44, borderRadius: 12, border: 'none',
            background: loading ? '#27272a' : 'linear-gradient(135deg, #22c55e, #16a34a)',
            color: '#fff', fontSize: 15, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}>
            {loading ? 'Creando...' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  )
}
