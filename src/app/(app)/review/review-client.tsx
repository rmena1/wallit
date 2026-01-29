'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmMovement, deleteReviewMovement, markAsReceivable, splitMovement } from '@/lib/actions/review'
import { formatMoney, parseMoney } from '@/lib/utils'
import type { Category, Account } from '@/lib/db'

interface PendingMovement {
  id: string
  name: string
  date: string
  amount: number
  type: 'income' | 'expense'
  currency: 'CLP' | 'USD'
  amountUsd: number | null
  exchangeRate: number | null
  categoryId: string | null
  accountId: string | null
  categoryName: string | null
  categoryEmoji: string | null
  accountBankName: string | null
  accountLastFour: string | null
}

interface Props {
  movements: PendingMovement[]
  accounts: Account[]
  categories: Category[]
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 48, borderRadius: 12,
  border: '1px solid #2a2a2a', backgroundColor: '#1a1a1a',
  fontSize: 15, color: '#e5e5e5', padding: '0 14px', outline: 'none',
  boxSizing: 'border-box',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2371717a' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
  backgroundPosition: 'right 12px center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '16px',
}

const labelStyle: React.CSSProperties = { fontSize: 13, color: '#71717a', marginBottom: 6, display: 'block' }

function centsToDisplay(cents: number): string {
  return (cents / 100).toString()
}

export function ReviewClient({ movements, accounts, categories }: Props) {
  const router = useRouter()
  const total = movements.length
  const [currentIndex, setCurrentIndex] = useState(0)
  const [confirmed, setConfirmed] = useState(0)
  const [skipped, setSkipped] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state for current movement
  const current = movements[currentIndex] as PendingMovement | undefined
  const [formName, setFormName] = useState(current?.name ?? '')
  const [formDate, setFormDate] = useState(current?.date ?? '')
  const [formAmount, setFormAmount] = useState(current ? centsToDisplay(current.amount) : '')
  const [formType, setFormType] = useState<'income' | 'expense'>(current?.type ?? 'expense')
  const [formCurrency, setFormCurrency] = useState<'CLP' | 'USD'>(current?.currency ?? 'CLP')
  const [formAccountId, setFormAccountId] = useState(current?.accountId ?? '')
  const [formCategoryId, setFormCategoryId] = useState(current?.categoryId ?? '')
  const [formAmountUsd, setFormAmountUsd] = useState(current?.amountUsd ? centsToDisplay(current.amountUsd) : '')
  const [formExchangeRate, setFormExchangeRate] = useState(current?.exchangeRate ? (current.exchangeRate / 100).toString() : '')

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  // Receivable state
  const [showReceivable, setShowReceivable] = useState(false)
  const [receivableText, setReceivableText] = useState('')
  // Split state
  const [showSplit, setShowSplit] = useState(false)
  const [splitItems, setSplitItems] = useState<{ name: string; amount: string }[]>([])

  const done = currentIndex >= total

  function loadMovement(idx: number) {
    const m = movements[idx]
    if (!m) return
    setFormName(m.name)
    setFormDate(m.date)
    setFormAmount(centsToDisplay(m.amount))
    setFormType(m.type)
    setFormCurrency(m.currency)
    setFormAccountId(m.accountId ?? '')
    setFormCategoryId(m.categoryId ?? '')
    setFormAmountUsd(m.amountUsd ? centsToDisplay(m.amountUsd) : '')
    setFormExchangeRate(m.exchangeRate ? (m.exchangeRate / 100).toString() : '')
    setError(null)
  }

  function goNext(didConfirm: boolean) {
    if (didConfirm) setConfirmed(c => c + 1)
    else setSkipped(s => s + 1)
    const next = currentIndex + 1
    setCurrentIndex(next)
    if (next < total) loadMovement(next)
  }

  async function handleConfirm() {
    if (!current) return
    setLoading(true)
    setError(null)
    try {
      const amountCents = parseMoney(formAmount)
      if (amountCents <= 0) { setError('Monto inválido'); setLoading(false); return }

      await confirmMovement(current.id, {
        name: formName.trim(),
        date: formDate,
        amount: amountCents,
        type: formType,
        currency: formCurrency,
        accountId: formAccountId || null,
        categoryId: formCategoryId || null,
        amountUsd: formCurrency === 'USD' ? parseMoney(formAmountUsd) || null : null,
        exchangeRate: formCurrency === 'USD' && formExchangeRate ? Math.round(parseFloat(formExchangeRate) * 100) : null,
      })
      goNext(true)
    } catch {
      setError('Error al confirmar')
    } finally {
      setLoading(false)
    }
  }

  function handleSkip() {
    goNext(false)
  }

  async function handleDelete() {
    if (!current) return
    setLoading(true)
    try {
      await deleteReviewMovement(current.id)
      setShowDeleteConfirm(false)
      goNext(false)
    } catch {
      setError('Error al eliminar')
    } finally {
      setLoading(false)
    }
  }

  async function handleReceivable() {
    if (!current || !receivableText.trim()) return
    setLoading(true)
    try {
      await markAsReceivable(current.id, receivableText.trim())
      setShowReceivable(false)
      setReceivableText('')
      goNext(true)
    } catch {
      setError('Error al marcar como por cobrar')
    } finally {
      setLoading(false)
    }
  }

  function openSplit() {
    if (!current) return
    setSplitItems([
      { name: current.name, amount: centsToDisplay(current.amount) },
      { name: '', amount: '' },
    ])
    setShowSplit(true)
  }

  function updateSplitItem(idx: number, field: 'name' | 'amount', value: string) {
    setSplitItems(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      // Auto-adjust first item amount
      if (field === 'amount' && idx !== 0 && current) {
        const totalCents = current.amount
        const totalDisplay = totalCents / 100
        let otherSum = 0
        for (let i = 1; i < next.length; i++) {
          otherSum += parseFloat(next[i].amount) || 0
        }
        next[0] = { ...next[0], amount: Math.max(0, totalDisplay - otherSum).toString() }
      }
      return next
    })
  }

  async function handleSplit() {
    if (!current) return
    setLoading(true)
    try {
      const splits = splitItems
        .filter(s => s.name.trim() && s.amount)
        .map(s => ({ name: s.name.trim(), amount: parseMoney(s.amount) }))
      if (splits.length < 2) { setError('Necesitas al menos 2 partes'); setLoading(false); return }
      await splitMovement(current.id, splits)
      setShowSplit(false)
      // Reload page to get new split movements
      router.refresh()
      window.location.reload()
    } catch {
      setError('Error al dividir')
    } finally {
      setLoading(false)
    }
  }

  if (total === 0) {
    return (
      <>
        <Header />
        <main style={{ maxWidth: 540, margin: '0 auto', padding: '40px 16px', textAlign: 'center' }}>
          <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>✅</span>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#e5e5e5', marginBottom: 8 }}>
            No hay movimientos pendientes
          </div>
          <button onClick={() => router.push('/')} style={primaryBtn}>
            Volver al inicio
          </button>
        </main>
      </>
    )
  }

  if (done) {
    return (
      <>
        <Header />
        <main style={{ maxWidth: 540, margin: '0 auto', padding: '40px 16px', textAlign: 'center' }}>
          <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>🎉</span>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#e5e5e5', marginBottom: 8 }}>
            ¡Revisión completada!
          </div>
          <div style={{ fontSize: 15, color: '#a1a1aa', marginBottom: 24 }}>
            {confirmed} confirmado{confirmed !== 1 ? 's' : ''} · {skipped} omitido{skipped !== 1 ? 's' : ''}
          </div>
          <button onClick={() => router.push('/')} style={primaryBtn}>
            Volver al inicio
          </button>
        </main>
      </>
    )
  }

  const reviewed = confirmed + skipped
  const remaining = total - reviewed

  return (
    <>
      <Header />
      <main style={{ maxWidth: 540, margin: '0 auto', padding: '16px 16px 96px' }}>
        {/* Progress */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: '#a1a1aa' }}>
              {reviewed} de {total} revisados
            </span>
            <span style={{ fontSize: 13, color: '#71717a' }}>
              {remaining} pendiente{remaining !== 1 ? 's' : ''}
            </span>
          </div>
          <div style={{ height: 4, backgroundColor: '#27272a', borderRadius: 2 }}>
            <div style={{
              height: '100%', borderRadius: 2,
              background: 'linear-gradient(90deg, #22c55e, #16a34a)',
              width: `${(reviewed / total) * 100}%`,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>

        {error && (
          <div style={{
            backgroundColor: '#450a0a', border: '1px solid #7f1d1d',
            borderRadius: 12, padding: '12px 16px', marginBottom: 16,
            fontSize: 14, color: '#fca5a5',
          }}>
            {error}
          </div>
        )}

        {/* Card */}
        <div style={{
          backgroundColor: '#1a1a1a', borderRadius: 16, padding: 20,
          border: '1px solid #2a2a2a',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Type toggle */}
            <div style={{
              display: 'flex', backgroundColor: '#111', borderRadius: 12,
              padding: 4, gap: 4, border: '1px solid #2a2a2a',
            }}>
              {(['expense', 'income'] as const).map(t => (
                <button key={t} type="button" onClick={() => setFormType(t)} style={{
                  flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                  fontSize: 15, fontWeight: 500, cursor: 'pointer',
                  backgroundColor: formType === t ? '#27272a' : 'transparent',
                  color: formType === t ? (t === 'expense' ? '#f87171' : '#4ade80') : '#52525b',
                  boxShadow: formType === t ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                  transition: 'all 0.2s ease',
                }}>
                  {t === 'expense' ? '↓ Gasto' : '↑ Ingreso'}
                </button>
              ))}
            </div>

            {/* Account */}
            <div>
              <label style={labelStyle}>Cuenta</label>
              <select value={formAccountId} onChange={e => setFormAccountId(e.target.value)} style={selectStyle}>
                <option value="">Sin cuenta</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.emoji || '🏦'} {a.bankName} · {a.accountType} · ···{a.lastFourDigits}</option>
                ))}
              </select>
            </div>

            {/* Name */}
            <div>
              <label style={labelStyle}>Descripción</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} autoFocus style={inputStyle} />
            </div>

            {/* Amount + Currency */}
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 2 }}>
                <label style={labelStyle}>Monto</label>
                <input value={formAmount} onChange={e => setFormAmount(e.target.value)}
                  inputMode="decimal" style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Moneda</label>
                <select value={formCurrency} onChange={e => setFormCurrency(e.target.value as 'CLP' | 'USD')} style={selectStyle}>
                  <option value="CLP">CLP</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>

            {/* USD fields */}
            {formCurrency === 'USD' && (
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Monto USD</label>
                  <input value={formAmountUsd} onChange={e => setFormAmountUsd(e.target.value)}
                    inputMode="decimal" style={inputStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Tipo de cambio</label>
                  <input value={formExchangeRate} onChange={e => setFormExchangeRate(e.target.value)}
                    inputMode="decimal" style={inputStyle} />
                </div>
              </div>
            )}

            {/* Date */}
            <div>
              <label style={labelStyle}>Fecha</label>
              <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                style={{ ...inputStyle, colorScheme: 'dark' }} />
            </div>

            {/* Category */}
            <div>
              <label style={labelStyle}>Categoría</label>
              <select value={formCategoryId} onChange={e => setFormCategoryId(e.target.value)} style={selectStyle}>
                <option value="">Sin categoría</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                ))}
              </select>
            </div>

            {/* Current values hint */}
            <div style={{ fontSize: 12, color: '#52525b', padding: '4px 0' }}>
              Original: {current!.name} · {formatMoney(current!.amount)} · {current!.date}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button onClick={handleSkip} disabled={loading} style={{
            flex: 1, height: 48, borderRadius: 12, border: '1px solid #2a2a2a',
            backgroundColor: '#1a1a1a', color: '#a1a1aa',
            fontSize: 15, fontWeight: 600, cursor: 'pointer',
          }}>
            Revisar después
          </button>
          <button onClick={handleConfirm} disabled={loading} style={{
            flex: 1, height: 48, borderRadius: 12, border: 'none',
            background: loading ? '#27272a' : 'linear-gradient(135deg, #22c55e, #16a34a)',
            color: '#fff', fontSize: 15, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            boxShadow: loading ? 'none' : '0 4px 12px rgba(34,197,94,0.3)',
          }}>
            {loading ? 'Guardando...' : 'Confirmar ✓'}
          </button>
        </div>

        {/* Secondary actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button onClick={() => setShowDeleteConfirm(true)} disabled={loading} style={{
            flex: 1, height: 42, borderRadius: 12, border: '1px solid #7f1d1d',
            backgroundColor: '#1a1a1a', color: '#f87171',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            🗑 Eliminar
          </button>
          <button onClick={() => { setShowReceivable(true); setReceivableText(current?.name || '') }} disabled={loading} style={{
            flex: 1, height: 42, borderRadius: 12, border: '1px solid #854d0e',
            backgroundColor: '#1a1a1a', color: '#fbbf24',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            💰 Por cobrar
          </button>
          <button onClick={openSplit} disabled={loading} style={{
            flex: 1, height: 42, borderRadius: 12, border: '1px solid #1e40af',
            backgroundColor: '#1a1a1a', color: '#60a5fa',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            ✂️ Dividir
          </button>
        </div>

        {/* Delete confirmation dialog */}
        {showDeleteConfirm && (
          <div style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
          }}>
            <div style={{
              backgroundColor: '#1a1a1a', borderRadius: 16, padding: 24,
              border: '1px solid #2a2a2a', maxWidth: 360, width: '100%',
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#e5e5e5', marginBottom: 8 }}>
                ¿Eliminar este movimiento?
              </div>
              <div style={{ fontSize: 14, color: '#a1a1aa', marginBottom: 20 }}>
                Esta acción no se puede deshacer.
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={() => setShowDeleteConfirm(false)} style={{
                  flex: 1, height: 44, borderRadius: 12, border: '1px solid #2a2a2a',
                  backgroundColor: '#27272a', color: '#a1a1aa',
                  fontSize: 15, fontWeight: 600, cursor: 'pointer',
                }}>
                  Cancelar
                </button>
                <button onClick={handleDelete} disabled={loading} style={{
                  flex: 1, height: 44, borderRadius: 12, border: 'none',
                  backgroundColor: '#dc2626', color: '#fff',
                  fontSize: 15, fontWeight: 600, cursor: 'pointer',
                }}>
                  {loading ? 'Eliminando...' : 'Eliminar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Receivable dialog */}
        {showReceivable && (
          <div style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
          }}>
            <div style={{
              backgroundColor: '#1a1a1a', borderRadius: 16, padding: 24,
              border: '1px solid #854d0e', maxWidth: 400, width: '100%',
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fbbf24', marginBottom: 8 }}>
                💰 Marcar como Por Cobrar
              </div>
              <div style={{ fontSize: 14, color: '#a1a1aa', marginBottom: 16 }}>
                Escribe un recordatorio (ej: &quot;Juan me debe la mitad&quot;)
              </div>
              <input
                value={receivableText}
                onChange={e => setReceivableText(e.target.value)}
                placeholder="Texto del recordatorio..."
                autoFocus
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button onClick={() => { setShowReceivable(false); setReceivableText('') }} style={{
                  flex: 1, height: 44, borderRadius: 12, border: '1px solid #2a2a2a',
                  backgroundColor: '#27272a', color: '#a1a1aa',
                  fontSize: 15, fontWeight: 600, cursor: 'pointer',
                }}>
                  Cancelar
                </button>
                <button onClick={handleReceivable} disabled={loading || !receivableText.trim()} style={{
                  flex: 1, height: 44, borderRadius: 12, border: 'none',
                  backgroundColor: '#d97706', color: '#fff',
                  fontSize: 15, fontWeight: 600, cursor: 'pointer',
                  opacity: receivableText.trim() ? 1 : 0.5,
                }}>
                  {loading ? 'Guardando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Split dialog */}
        {showSplit && current && (
          <div style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50,
            padding: 16, overflowY: 'auto',
          }}>
            <div style={{
              backgroundColor: '#1a1a1a', borderRadius: 16, padding: 24,
              border: '1px solid #1e40af', maxWidth: 440, width: '100%', marginTop: 40,
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#60a5fa', marginBottom: 4 }}>
                ✂️ Dividir Movimiento
              </div>
              <div style={{
                fontSize: 14, color: '#a1a1aa', marginBottom: 16,
                padding: '8px 12px', backgroundColor: '#111', borderRadius: 8,
              }}>
                Total: <strong style={{ color: '#e5e5e5' }}>{formatMoney(current.amount)}</strong>
                {' · '}{current.name}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {splitItems.map((item, idx) => (
                  <div key={idx} style={{
                    display: 'flex', gap: 8, alignItems: 'center',
                    padding: '10px 12px', backgroundColor: idx === 0 ? '#1a2a1a' : '#111',
                    borderRadius: 10, border: '1px solid #2a2a2a',
                  }}>
                    <span style={{ fontSize: 13, color: '#71717a', width: 20, flexShrink: 0 }}>{idx + 1}</span>
                    <input
                      value={item.name}
                      onChange={e => updateSplitItem(idx, 'name', e.target.value)}
                      placeholder="Descripción"
                      style={{ ...inputStyle, height: 40, fontSize: 14, flex: 2 }}
                    />
                    <input
                      value={item.amount}
                      onChange={e => updateSplitItem(idx, 'amount', e.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                      readOnly={idx === 0}
                      style={{
                        ...inputStyle, height: 40, fontSize: 14, flex: 1, textAlign: 'right',
                        ...(idx === 0 ? { backgroundColor: '#0a0a0a', color: '#71717a' } : {}),
                      }}
                    />
                  </div>
                ))}
              </div>

              <button
                onClick={() => setSplitItems(prev => [...prev, { name: '', amount: '' }])}
                style={{
                  marginTop: 10, padding: '8px 16px', borderRadius: 10,
                  border: '1px dashed #2a2a2a', backgroundColor: 'transparent',
                  color: '#60a5fa', fontSize: 14, cursor: 'pointer', width: '100%',
                }}
              >
                + Agregar
              </button>

              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button onClick={() => setShowSplit(false)} style={{
                  flex: 1, height: 44, borderRadius: 12, border: '1px solid #2a2a2a',
                  backgroundColor: '#27272a', color: '#a1a1aa',
                  fontSize: 15, fontWeight: 600, cursor: 'pointer',
                }}>
                  Cancelar
                </button>
                <button onClick={handleSplit} disabled={loading} style={{
                  flex: 1, height: 44, borderRadius: 12, border: 'none',
                  backgroundColor: '#2563eb', color: '#fff',
                  fontSize: 15, fontWeight: 600, cursor: 'pointer',
                }}>
                  {loading ? 'Dividiendo...' : 'Confirmar división'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  )
}

function Header() {
  const router = useRouter()
  return (
    <header style={{
      backgroundColor: '#111111', borderBottom: '1px solid #1e1e1e',
      padding: '12px 16px', position: 'sticky', top: 0, zIndex: 10,
    }}>
      <div style={{ maxWidth: 540, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => router.push('/')} style={{
          background: 'none', border: 'none', color: '#a1a1aa',
          fontSize: 15, cursor: 'pointer', padding: '4px 0',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Volver
        </button>
        <span style={{ fontSize: 17, fontWeight: 700, color: '#f5f5f5' }}>Revisión de Movimientos</span>
        <div style={{ width: 60 }} />
      </div>
    </header>
  )
}

const primaryBtn: React.CSSProperties = {
  display: 'inline-block', padding: '12px 32px', borderRadius: 12, border: 'none',
  background: 'linear-gradient(135deg, #22c55e, #16a34a)',
  color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(34,197,94,0.3)',
}
