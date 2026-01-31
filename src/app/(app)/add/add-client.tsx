'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createMovement } from '@/lib/actions/movements'
import { today, parseMoney, formatCurrency } from '@/lib/utils'
import { CreateCategoryDialog } from '@/components/create-category-dialog'
import type { Category, Account } from '@/lib/db'

interface AddMovementPageProps {
  accounts: Account[]
  categories: Category[]
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 48, borderRadius: 12,
  border: '1px solid #2a2a2a', backgroundColor: '#1a1a1a',
  fontSize: 15, color: '#e5e5e5', padding: '0 14px', outline: 'none',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2371717a' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
  backgroundPosition: 'right 12px center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '16px',
}

export function AddMovementPage({ accounts, categories }: AddMovementPageProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currency, setCurrency] = useState<'CLP' | 'USD'>('CLP')
  const [showCreateCategory, setShowCreateCategory] = useState(false)
  const [localCategories, setLocalCategories] = useState(categories)
  const [selectedCategoryId, setSelectedCategoryId] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const form = e.currentTarget
      const formData = new FormData(form)
      const amountStr = formData.get('amount') as string
      const cents = parseMoney(amountStr)
      formData.set('amount', cents.toString())
      const result = await createMovement(formData)
      if (!result.success) {
        setError(result.error || 'Error al crear movimiento')
      } else {
        router.push('/')
      }
    } catch {
      setError('Ocurrió un error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Header */}
      <header style={{
        backgroundColor: '#111111',
        borderBottom: '1px solid #1e1e1e',
        padding: '12px 16px',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ maxWidth: 540, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={() => router.back()}
            style={{
              background: 'none', border: 'none', color: '#a1a1aa',
              fontSize: 15, cursor: 'pointer', padding: '4px 0',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Volver
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#f5f5f5' }}>Nuevo Movimiento</span>
          <div style={{ width: 60 }} />
        </div>
      </header>

      <main style={{ maxWidth: 540, margin: '0 auto', padding: '20px 16px 96px' }}>
        {error && (
          <div style={{
            backgroundColor: '#450a0a', border: '1px solid #7f1d1d',
            borderRadius: 12, padding: '12px 16px', marginBottom: 16,
            fontSize: 14, color: '#fca5a5',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Type Toggle */}
            <div style={{
              display: 'flex', backgroundColor: '#1a1a1a', borderRadius: 12,
              padding: 4, gap: 4, border: '1px solid #2a2a2a',
            }}>
              {(['expense', 'income'] as const).map((t) => (
                <label key={t} style={{
                  flex: 1, textAlign: 'center', cursor: 'pointer',
                }}>
                  <input
                    type="radio" name="type" value={t}
                    defaultChecked={t === 'expense'}
                    style={{ display: 'none' }}
                    className="type-radio"
                  />
                  <span className={`type-label type-label-${t}`} style={{
                    display: 'block', padding: '10px 0', borderRadius: 10,
                    fontSize: 15, fontWeight: 500,
                    transition: 'all 0.2s ease',
                  }}>
                    {t === 'expense' ? '↓ Gasto' : '↑ Ingreso'}
                  </span>
                </label>
              ))}
            </div>

            {/* Account selector */}
            <div>
              <label style={{ fontSize: 13, color: '#71717a', marginBottom: 6, display: 'block' }}>Cuenta</label>
              <select name="accountId" required defaultValue="" style={selectStyle}>
                <option value="" disabled>Seleccionar cuenta</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.emoji || '🏦'} {acc.bankName} · {acc.accountType} · ···{acc.lastFourDigits}
                  </option>
                ))}
              </select>
            </div>

            {/* Name */}
            <div>
              <label style={{ fontSize: 13, color: '#71717a', marginBottom: 6, display: 'block' }}>Descripción</label>
              <input
                name="name" type="text" placeholder="¿En qué se gastó?"
                required autoComplete="off"
                style={inputStyle}
              />
            </div>

            {/* Amount + Currency + Date */}
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 2 }}>
                <label style={{ fontSize: 13, color: '#71717a', marginBottom: 6, display: 'block' }}>{currency === 'USD' ? 'Monto pesos' : 'Monto'}</label>
                <input
                  name="amount" type="text" placeholder="0.00"
                  required inputMode="decimal" autoComplete="off"
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 13, color: '#71717a', marginBottom: 6, display: 'block' }}>Moneda</label>
                <select name="currency" defaultValue="CLP" onChange={e => setCurrency(e.target.value as 'CLP' | 'USD')} style={selectStyle}>
                  <option value="CLP">CLP</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 2 }}>
                <label style={{ fontSize: 13, color: '#71717a', marginBottom: 6, display: 'block' }}>Fecha</label>
                <input
                  name="date" type="date" defaultValue={today()} required
                  style={{ ...inputStyle, colorScheme: 'dark' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 13, color: '#71717a', marginBottom: 6, display: 'block' }}>Hora</label>
                <input
                  name="time" type="time"
                  style={{ ...inputStyle, colorScheme: 'dark' }}
                />
              </div>
            </div>

            {/* Category */}
            <div>
              <label style={{ fontSize: 13, color: '#71717a', marginBottom: 6, display: 'block' }}>Categoría</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select name="categoryId" value={selectedCategoryId} onChange={e => setSelectedCategoryId(e.target.value)} style={{ ...selectStyle, flex: 1 }}>
                  <option value="">Sin categoría</option>
                  {localCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.emoji} {cat.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setShowCreateCategory(true)} style={{
                  width: 48, height: 48, borderRadius: 12, border: '1px solid #2a2a2a',
                  backgroundColor: '#1a1a1a', color: '#22c55e', fontSize: 20,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>+</button>
              </div>
            </div>

            <button
              type="submit" disabled={loading}
              style={{
                width: '100%', height: 48, borderRadius: 12, border: 'none',
                background: loading ? '#27272a' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: '#fff', fontSize: 16, fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                marginTop: 4,
                boxShadow: loading ? 'none' : '0 4px 12px rgba(34,197,94,0.3)',
              }}
            >
              {loading ? 'Guardando...' : 'Guardar Movimiento'}
            </button>
          </div>
        </form>
      </main>

      <CreateCategoryDialog
        open={showCreateCategory}
        onClose={() => setShowCreateCategory(false)}
        onCreated={(id, name, emoji) => {
          setLocalCategories(prev => [...prev, { id, name, emoji, userId: '', createdAt: new Date(), updatedAt: new Date() }])
          setSelectedCategoryId(id)
        }}
      />

      <style>{`
        .type-radio:checked + .type-label {
          background: #27272a;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .type-radio:not(:checked) + .type-label {
          color: #52525b;
        }
        .type-radio:checked + .type-label-expense {
          color: #f87171;
        }
        .type-radio:checked + .type-label-income {
          color: #4ade80;
        }
      `}</style>
    </>
  )
}
