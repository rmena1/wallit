'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { confirmMovement, deleteReviewMovement, markAsReceivable, splitMovement } from '@/lib/actions/review'
import { convertToTransfer, getCurrentExchangeRate } from '@/lib/actions/transfers'
import { parseMoney as parseMoneyUtil } from '@/lib/utils'
import { formatCurrency, parseMoney } from '@/lib/utils'
import { CreateCategoryDialog } from '@/components/create-category-dialog'
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
  time: string | null
  originalName: string | null
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
  width: '100%', height: 36, borderRadius: 8,
  border: '1px solid #2a2a2a', backgroundColor: '#1a1a1a',
  fontSize: 14, color: '#e5e5e5', padding: '0 10px', outline: 'none',
  boxSizing: 'border-box',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2371717a' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
  backgroundPosition: 'right 8px center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '14px',
}

const labelStyle: React.CSSProperties = { fontSize: 11, color: '#71717a', marginBottom: 2, display: 'block' }

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
  const [formTime, setFormTime] = useState(current?.time ?? '')

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showReceivable, setShowReceivable] = useState(false)
  const [receivableText, setReceivableText] = useState('')
  const [showSplit, setShowSplit] = useState(false)
  const [splitItems, setSplitItems] = useState<{ name: string; amount: string }[]>([])
  const [showCreateCategory, setShowCreateCategory] = useState(false)
  const [localCategories, setLocalCategories] = useState(categories)
  
  // Transfer mode state
  const [isTransferMode, setIsTransferMode] = useState(false)
  const [transferToAccountId, setTransferToAccountId] = useState('')
  const [transferToAmount, setTransferToAmount] = useState('')
  const [transferNote, setTransferNote] = useState('')
  const [exchangeRate, setExchangeRate] = useState<number | null>(null)

  // Get exchange rate for currency conversion
  useEffect(() => {
    getCurrentExchangeRate().then(setExchangeRate).catch(() => {})
  }, [])

  const done = currentIndex >= total

  // Ensure form fields sync whenever currentIndex changes
  useEffect(() => {
    const m = movements[currentIndex]
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
    setFormTime(m.time ?? '')
    setError(null)
    // Reset transfer mode when moving to new movement
    setIsTransferMode(false)
    setTransferToAccountId('')
    setTransferToAmount('')
    setTransferNote('')
  }, [currentIndex, movements])

  // Get currencies for transfer calculation
  const fromAccount = accounts.find(a => a.id === formAccountId)
  const toAccountForTransfer = accounts.find(a => a.id === transferToAccountId)
  const fromCurrency = fromAccount?.currency || 'CLP'
  const toCurrencyTransfer = toAccountForTransfer?.currency || 'CLP'
  const currenciesDifferTransfer = fromCurrency !== toCurrencyTransfer

  // Auto-calculate transfer toAmount when formAmount or accounts change
  useEffect(() => {
    if (!isTransferMode || !transferToAccountId || !formAmount) return
    
    const fromCents = parseMoney(formAmount)
    if (fromCents <= 0) return
    
    if (currenciesDifferTransfer && exchangeRate) {
      let toCents: number
      if (fromCurrency === 'USD' && toCurrencyTransfer === 'CLP') {
        toCents = Math.round(fromCents * exchangeRate / 100)
      } else if (fromCurrency === 'CLP' && toCurrencyTransfer === 'USD') {
        toCents = Math.round(fromCents * 100 / exchangeRate)
      } else {
        toCents = fromCents
      }
      setTransferToAmount((toCents / 100).toString())
    } else if (!currenciesDifferTransfer) {
      setTransferToAmount(formAmount)
    }
  }, [isTransferMode, formAmount, transferToAccountId, fromCurrency, toCurrencyTransfer, currenciesDifferTransfer, exchangeRate])

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
    setFormTime(m.time ?? '')
    setError(null)
    // Reset transfer mode
    setIsTransferMode(false)
    setTransferToAccountId('')
    setTransferToAmount('')
    setTransferNote('')
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
      
      // If in transfer mode, convert to transfer instead of normal confirm
      if (isTransferMode) {
        if (!formAccountId) {
          setError('Selecciona una cuenta origen')
          setLoading(false)
          return
        }
        if (!transferToAccountId) {
          setError('Selecciona una cuenta destino')
          setLoading(false)
          return
        }
        if (formAccountId === transferToAccountId) {
          setError('Las cuentas deben ser diferentes')
          setLoading(false)
          return
        }
        const toAmountCents = parseMoney(transferToAmount)
        if (toAmountCents <= 0) {
          setError('Monto destino inválido')
          setLoading(false)
          return
        }
        
        // First confirm the movement with updated data
        await confirmMovement(current.id, {
          name: formName.trim(),
          date: formDate,
          amount: amountCents,
          type: 'expense', // Transfers are always expense from origin
          currency: formCurrency,
          accountId: formAccountId,
          categoryId: null, // Transfers don't have category
          amountUsd: formCurrency === 'USD' ? parseMoney(formAmountUsd) || null : null,
          exchangeRate: formCurrency === 'USD' && formExchangeRate ? Math.round(parseFloat(formExchangeRate) * 100) : null,
          time: formTime || null,
        })
        
        // Then convert to transfer
        const result = await convertToTransfer({
          movementId: current.id,
          toAccountId: transferToAccountId,
          toAmount: toAmountCents,
          toCurrency: toCurrencyTransfer,
          note: transferNote.trim() || undefined,
        })
        
        if (!result.success) {
          setError(result.error || 'Error al convertir a transferencia')
          setLoading(false)
          return
        }
        
        goNext(true)
        return
      }
      
      // Normal confirmation
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
        time: formTime || null,
      })
      goNext(true)
    } catch {
      setError('Error al confirmar')
    } finally {
      setLoading(false)
    }
  }

  function handleSkip() { goNext(false) }

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
      if (field === 'amount' && idx !== 0 && current) {
        const totalDisplay = current.amount / 100
        let otherSum = 0
        for (let i = 1; i < next.length; i++) otherSum += parseFloat(next[i].amount) || 0
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
      const result = await splitMovement(current.id, splits)
      if (result && !result.success) {
        setError(result.error || 'Error al dividir')
        setLoading(false)
        return
      }
      setShowSplit(false)
      router.refresh()
      window.location.reload()
    } catch (err) {
      setError(`Error al dividir: ${err instanceof Error ? err.message : String(err)}`)
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
          <button onClick={() => router.push('/')} style={primaryBtn}>Volver al inicio</button>
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
          <button onClick={() => router.push('/')} style={primaryBtn}>Volver al inicio</button>
        </main>
      </>
    )
  }

  const reviewed = confirmed + skipped

  return (
    <>
      <Header />
      <main style={{ maxWidth: 540, margin: '0 auto', padding: '8px 12px 0' }}>
        {/* Progress bar - compact */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#a1a1aa', whiteSpace: 'nowrap' }}>
            {reviewed + 1}/{total}
          </span>
          <div style={{ flex: 1, height: 3, backgroundColor: '#27272a', borderRadius: 2 }}>
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
            borderRadius: 8, padding: '6px 10px', marginBottom: 6,
            fontSize: 13, color: '#fca5a5',
          }}>
            {error}
          </div>
        )}

        {/* Card */}
        <div style={{
          backgroundColor: '#1a1a1a', borderRadius: 12, padding: '12px 14px',
          border: '1px solid #2a2a2a',
        }}>
          {/* Prominent amount + name header */}
          <div style={{ textAlign: 'center', marginBottom: 10 }}>
            <div style={{
              fontSize: 28, fontWeight: 800,
              color: formType === 'expense' ? '#f87171' : '#4ade80',
              lineHeight: 1.1,
            }}>
              {formatCurrency(current!.amount, 'CLP')}
            </div>
            <div style={{ fontSize: 13, color: '#a1a1aa', marginTop: 2 }}>
              {current!.name}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Type toggle - compact with transfer option */}
            <div style={{
              display: 'flex', backgroundColor: '#111', borderRadius: 8,
              padding: 2, gap: 2, border: '1px solid #2a2a2a',
            }}>
              {(['expense', 'income', 'transfer'] as const).map(t => (
                <button key={t} type="button" onClick={() => {
                  if (t === 'transfer') {
                    setIsTransferMode(true)
                    setFormType('expense') // Transfers start as expense
                  } else {
                    setIsTransferMode(false)
                    setFormType(t)
                  }
                }} style={{
                  flex: 1, padding: '6px 0', borderRadius: 6, border: 'none',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  backgroundColor: (t === 'transfer' ? isTransferMode : (!isTransferMode && formType === t)) ? '#27272a' : 'transparent',
                  color: (t === 'transfer' ? isTransferMode : (!isTransferMode && formType === t)) 
                    ? (t === 'expense' ? '#f87171' : t === 'income' ? '#4ade80' : '#60a5fa') 
                    : '#52525b',
                  transition: 'all 0.15s ease',
                }}>
                  {t === 'expense' ? '↓ Gasto' : t === 'income' ? '↑ Ingreso' : '↔️ Transfer'}
                </button>
              ))}
            </div>

            {/* Row: Nombre (full width) */}
            <div>
              <label style={labelStyle}>Descripción</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} style={inputStyle} />
            </div>

            {/* Row: Monto | Moneda */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 6 }}>
              <div>
                <label style={labelStyle}>Monto</label>
                <input value={formAmount} onChange={e => setFormAmount(e.target.value)}
                  inputMode="decimal" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Moneda</label>
                <select value={formCurrency} onChange={e => setFormCurrency(e.target.value as 'CLP' | 'USD')} style={selectStyle}>
                  <option value="CLP">CLP</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>

            {/* USD fields */}
            {formCurrency === 'USD' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div>
                  <label style={labelStyle}>Monto USD</label>
                  <input value={formAmountUsd} onChange={e => setFormAmountUsd(e.target.value)}
                    inputMode="decimal" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Tipo cambio</label>
                  <input value={formExchangeRate} onChange={e => setFormExchangeRate(e.target.value)}
                    inputMode="decimal" style={inputStyle} />
                </div>
              </div>
            )}

            {/* Row: Cuenta | Categoría (or Transfer destination) */}
            {isTransferMode ? (
              <>
                {/* Transfer: From Account */}
                <div>
                  <label style={labelStyle}>Desde cuenta (origen)</label>
                  <select value={formAccountId} onChange={e => setFormAccountId(e.target.value)} style={{
                    ...selectStyle,
                    ...(formAccountId === '' ? { border: '1px solid #f59e0b40', backgroundColor: '#1a1812' } : {})
                  }}>
                    <option value="">Seleccionar cuenta origen</option>
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>{a.emoji || '🏦'} {a.bankName} ···{a.lastFourDigits} ({a.currency})</option>
                    ))}
                  </select>
                </div>
                
                {/* Transfer: To Account */}
                <div>
                  <label style={labelStyle}>Hacia cuenta (destino)</label>
                  <select value={transferToAccountId} onChange={e => setTransferToAccountId(e.target.value)} style={{
                    ...selectStyle,
                    ...(transferToAccountId === '' ? { border: '1px solid #f59e0b40', backgroundColor: '#1a1812' } : {})
                  }}>
                    <option value="">Seleccionar cuenta destino</option>
                    {accounts.filter(a => a.id !== formAccountId).map(a => (
                      <option key={a.id} value={a.id}>{a.emoji || '🏦'} {a.bankName} ···{a.lastFourDigits} ({a.currency})</option>
                    ))}
                  </select>
                </div>
                
                {/* Transfer: Destination Amount (if currencies differ) */}
                {currenciesDifferTransfer && (
                  <div>
                    <label style={labelStyle}>Monto destino ({toCurrencyTransfer})</label>
                    <input
                      type="text"
                      placeholder="0.00"
                      inputMode="decimal"
                      value={transferToAmount}
                      onChange={e => setTransferToAmount(e.target.value)}
                      style={inputStyle}
                    />
                    {exchangeRate && (
                      <div style={{ fontSize: 10, color: '#71717a', marginTop: 2 }}>
                        💱 1 USD = {(exchangeRate / 100).toFixed(2)} CLP
                      </div>
                    )}
                  </div>
                )}
                
                {/* Transfer: Note (optional) */}
                <div>
                  <label style={labelStyle}>Nota (opcional)</label>
                  <input
                    type="text"
                    placeholder="ej: Pago tarjeta de crédito"
                    value={transferNote}
                    onChange={e => setTransferNote(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div>
                  <label style={labelStyle}>Cuenta</label>
                  <select value={formAccountId} onChange={e => setFormAccountId(e.target.value)} style={selectStyle}>
                    <option value="">Sin cuenta</option>
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>{a.emoji || '🏦'} ···{a.lastFourDigits}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Categoría</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <select 
                      value={formCategoryId} 
                      onChange={e => setFormCategoryId(e.target.value)} 
                      style={{ 
                        ...selectStyle, 
                        flex: 1,
                        ...(formCategoryId === '' ? {
                          border: '1px solid #f59e0b40',
                          backgroundColor: '#1a1812',
                        } : {})
                      }}
                    >
                      <option value="">⚠️ Sin categoría</option>
                      {localCategories.map(c => (
                        <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => setShowCreateCategory(true)} style={{
                      width: 36, height: 36, borderRadius: 8, border: '1px solid #2a2a2a',
                      backgroundColor: '#1a1a1a', color: '#22c55e', fontSize: 16,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, padding: 0,
                    }}>+</button>
                  </div>
                </div>
              </div>
            )}

            {/* Row: Fecha + Hora */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 6 }}>
              <div>
                <label style={labelStyle}>Fecha</label>
                <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                  style={{ ...inputStyle, colorScheme: 'dark' }} />
              </div>
              <div>
                <label style={labelStyle}>Hora</label>
                <input type="time" value={formTime} onChange={e => setFormTime(e.target.value)}
                  style={{ ...inputStyle, colorScheme: 'dark' }} />
              </div>
            </div>

            {/* Original Name */}
            {current!.originalName && (
              <div style={{ fontSize: 11, color: '#52525b', padding: '4px 8px', backgroundColor: '#111', borderRadius: 6 }}>
                Original: {current!.originalName}
              </div>
            )}
          </div>
        </div>

        {/* Primary action buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={handleSkip} disabled={loading} style={{
            flex: 1, height: 40, borderRadius: 10, border: '1px solid #2a2a2a',
            backgroundColor: '#1a1a1a', color: '#a1a1aa',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            Después →
          </button>
          <button onClick={handleConfirm} disabled={loading} style={{
            flex: 1.3, height: 40, borderRadius: 10, border: 'none',
            background: loading ? '#27272a' : isTransferMode 
              ? 'linear-gradient(135deg, #3b82f6, #2563eb)'
              : 'linear-gradient(135deg, #22c55e, #16a34a)',
            color: '#fff', fontSize: 14, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            boxShadow: loading ? 'none' : isTransferMode 
              ? '0 2px 8px rgba(59,130,246,0.3)'
              : '0 2px 8px rgba(34,197,94,0.3)',
          }}>
            {loading ? '...' : isTransferMode ? '↔️ Crear Transfer' : '✓ Confirmar'}
          </button>
        </div>

        {/* Secondary actions - icon-style compact */}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button onClick={() => setShowDeleteConfirm(true)} disabled={loading} style={{
            flex: 1, height: 34, borderRadius: 8, border: '1px solid #7f1d1d',
            backgroundColor: '#1a1a1a', color: '#f87171',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            🗑 Eliminar
          </button>
          <button onClick={() => { setShowReceivable(true); setReceivableText(current?.name || '') }} disabled={loading} style={{
            flex: 1, height: 34, borderRadius: 8, border: '1px solid #854d0e',
            backgroundColor: '#1a1a1a', color: '#fbbf24',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            💰 Cobrar
          </button>
          <button onClick={openSplit} disabled={loading} style={{
            flex: 1, height: 34, borderRadius: 8, border: '1px solid #1e40af',
            backgroundColor: '#1a1a1a', color: '#60a5fa',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
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
                }}>Cancelar</button>
                <button onClick={handleDelete} disabled={loading} style={{
                  flex: 1, height: 44, borderRadius: 12, border: 'none',
                  backgroundColor: '#dc2626', color: '#fff',
                  fontSize: 15, fontWeight: 600, cursor: 'pointer',
                }}>{loading ? 'Eliminando...' : 'Eliminar'}</button>
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
              <input value={receivableText} onChange={e => setReceivableText(e.target.value)}
                placeholder="Texto del recordatorio..." autoFocus style={inputStyle} />
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button onClick={() => { setShowReceivable(false); setReceivableText('') }} style={{
                  flex: 1, height: 44, borderRadius: 12, border: '1px solid #2a2a2a',
                  backgroundColor: '#27272a', color: '#a1a1aa',
                  fontSize: 15, fontWeight: 600, cursor: 'pointer',
                }}>Cancelar</button>
                <button onClick={handleReceivable} disabled={loading || !receivableText.trim()} style={{
                  flex: 1, height: 44, borderRadius: 12, border: 'none',
                  backgroundColor: '#d97706', color: '#fff',
                  fontSize: 15, fontWeight: 600, cursor: 'pointer',
                  opacity: receivableText.trim() ? 1 : 0.5,
                }}>{loading ? 'Guardando...' : 'Confirmar'}</button>
              </div>
            </div>
          </div>
        )}

        <CreateCategoryDialog
          open={showCreateCategory}
          onClose={() => setShowCreateCategory(false)}
          onCreated={(id, name, emoji) => {
            setLocalCategories(prev => [...prev, { id, name, emoji, userId: '', createdAt: new Date(), updatedAt: new Date() }])
            setFormCategoryId(id)
          }}
        />

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
                Total: <strong style={{ color: '#e5e5e5' }}>{formatCurrency(current.amount, current.currency)}</strong>
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
                    <input value={item.name} onChange={e => updateSplitItem(idx, 'name', e.target.value)}
                      placeholder="Descripción" style={{ ...inputStyle, height: 40, fontSize: 14, flex: 2 }} />
                    <input value={item.amount} onChange={e => updateSplitItem(idx, 'amount', e.target.value)}
                      placeholder="0" inputMode="decimal" readOnly={idx === 0}
                      style={{ ...inputStyle, height: 40, fontSize: 14, flex: 1, textAlign: 'right',
                        ...(idx === 0 ? { backgroundColor: '#0a0a0a', color: '#71717a' } : {}),
                      }} />
                  </div>
                ))}
              </div>
              <button onClick={() => setSplitItems(prev => [...prev, { name: '', amount: '' }])}
                style={{
                  marginTop: 10, padding: '8px 16px', borderRadius: 10,
                  border: '1px dashed #2a2a2a', backgroundColor: 'transparent',
                  color: '#60a5fa', fontSize: 14, cursor: 'pointer', width: '100%',
                }}>+ Agregar</button>
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button onClick={() => setShowSplit(false)} style={{
                  flex: 1, height: 44, borderRadius: 12, border: '1px solid #2a2a2a',
                  backgroundColor: '#27272a', color: '#a1a1aa',
                  fontSize: 15, fontWeight: 600, cursor: 'pointer',
                }}>Cancelar</button>
                <button onClick={handleSplit} disabled={loading} style={{
                  flex: 1, height: 44, borderRadius: 12, border: 'none',
                  backgroundColor: '#2563eb', color: '#fff',
                  fontSize: 15, fontWeight: 600, cursor: 'pointer',
                }}>{loading ? 'Dividiendo...' : 'Confirmar división'}</button>
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
      padding: '8px 12px', position: 'sticky', top: 0, zIndex: 10,
    }}>
      <div style={{ maxWidth: 540, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => router.push('/')} style={{
          background: 'none', border: 'none', color: '#a1a1aa',
          fontSize: 14, cursor: 'pointer', padding: '2px 0',
          display: 'flex', alignItems: 'center', gap: 2,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#f5f5f5' }}>Revisión</span>
        <div style={{ width: 24 }} />
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
