'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { updateMovement, deleteMovement } from '@/lib/actions/movements'
import { markAsReceivable, unmarkReceivable, splitMovement } from '@/lib/actions/review'
import { convertToTransfer, getCurrentExchangeRate } from '@/lib/actions/transfers'
import { hasEmergencyPayments } from '@/lib/actions/emergency'
import { hasLoanPaybackExpenses } from '@/lib/actions/loans'
import { formatMovementDisplayAmount, parseMoney } from '@/lib/utils'
import { CreateCategoryDialog } from '@/components/create-category-dialog'
import type { Category, Account } from '@/lib/db'

interface MovementData {
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
  receivable: boolean
  received: boolean
  time: string | null
  originalName: string | null
  emergency: boolean
  loan: boolean
}

interface Props {
  movement: MovementData
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

const labelStyle: React.CSSProperties = { fontSize: 13, color: '#a1a1aa', marginBottom: 6, display: 'block' }

function centsToDisplay(cents: number): string {
  return (cents / 100).toString()
}

export function EditClient({ movement, accounts, categories }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [formName, setFormName] = useState(movement.name)
  const [formDate, setFormDate] = useState(movement.date)
  const [formAmount, setFormAmount] = useState(centsToDisplay(movement.amount))
  const [formType, setFormType] = useState<'income' | 'expense'>(movement.type)
  const [formCurrency, setFormCurrency] = useState<'CLP' | 'USD'>(movement.currency)
  const [formAccountId, setFormAccountId] = useState(movement.accountId ?? '')
  const [formCategoryId, setFormCategoryId] = useState(movement.categoryId ?? '')
  const [formAmountUsd, setFormAmountUsd] = useState(movement.amountUsd ? centsToDisplay(movement.amountUsd) : '')
  const [formExchangeRate, setFormExchangeRate] = useState(movement.exchangeRate ? (movement.exchangeRate / 100).toString() : '')
  const [formTime, setFormTime] = useState(movement.time ?? '')

  const [formEmergency, setFormEmergency] = useState(movement.emergency)
  const [formLoan, setFormLoan] = useState(movement.loan)

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

  async function handleToggleEmergency(checked: boolean) {
    if (!checked && movement.emergency) {
      // Turning off - check if payments exist
      const hasPayments = await hasEmergencyPayments(movement.id)
      if (hasPayments) {
        setError('No se puede desmarcar: ya existen abonos para este gasto de emergencia')
        return
      }
    }
    setFormEmergency(checked)
    setError(null)
  }

  async function handleToggleLoan(checked: boolean) {
    if (!checked && movement.loan) {
      const hasPaybacks = await hasLoanPaybackExpenses(movement.id)
      if (hasPaybacks) {
        setError('No se puede desmarcar: ya existen devoluciones vinculadas a este préstamo')
        return
      }
    }
    setFormLoan(checked)
    setError(null)
  }

  async function handleSave() {
    setLoading(true)
    setError(null)
    try {
      const amountCents = parseMoney(formAmount)
      if (amountCents <= 0) { setError('Monto inválido'); setLoading(false); return }

      // If in transfer mode, convert to transfer
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
        
        // First update the movement
        await updateMovement(movement.id, {
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
          movementId: movement.id,
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
        
        router.push('/')
        return
      }

      // Normal update
      if (movement.loan && (formType !== 'income' || !formLoan)) {
        const hasPaybacks = await hasLoanPaybackExpenses(movement.id)
        if (hasPaybacks) {
          setError('No se puede desmarcar: ya existen devoluciones vinculadas a este préstamo')
          setLoading(false)
          return
        }
      }

      await updateMovement(movement.id, {
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
        emergency: formType === 'expense' ? formEmergency : false,
        loan: formType === 'income' ? formLoan : false,
      })
      router.push('/')
    } catch {
      setError('Error al guardar')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    setLoading(true)
    try {
      await deleteMovement(movement.id)
      setShowDeleteConfirm(false)
      router.push('/')
    } catch {
      setError('Error al eliminar')
    } finally {
      setLoading(false)
    }
  }

  async function handleReceivable() {
    if (!receivableText.trim()) return
    setLoading(true)
    try {
      await markAsReceivable(movement.id, receivableText.trim())
      setShowReceivable(false)
      router.push('/')
    } catch {
      setError('Error al marcar como por cobrar')
    } finally {
      setLoading(false)
    }
  }

  function openSplit() {
    setSplitItems([
      { name: movement.name, amount: centsToDisplay(movement.amount) },
      { name: '', amount: '' },
    ])
    setShowSplit(true)
  }

  function updateSplitItem(idx: number, field: 'name' | 'amount', value: string) {
    setSplitItems(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      if (field === 'amount' && idx !== 0) {
        const totalDisplay = movement.amount / 100
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
    setLoading(true)
    try {
      const splits = splitItems
        .filter(s => s.name.trim() && s.amount)
        .map(s => ({ name: s.name.trim(), amount: parseMoney(s.amount) }))
      if (splits.length < 2) { setError('Necesitas al menos 2 partes'); setLoading(false); return }
      const result = await splitMovement(movement.id, splits)
      if (result && !result.success) {
        setError(result.error || 'Error al dividir')
        setLoading(false)
        return
      }
      router.push('/')
    } catch (err) {
      setError(`Error al dividir: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Header */}
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
          <span style={{ fontSize: 17, fontWeight: 700, color: '#f5f5f5' }}>Editar Movimiento</span>
          <div style={{ width: 60 }} />
        </div>
      </header>

      <main style={{ maxWidth: 540, margin: '0 auto', padding: '16px 16px 96px' }}>
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
            {/* Type toggle with transfer option */}
            <div style={{
              display: 'flex', backgroundColor: '#111', borderRadius: 12,
              padding: 4, gap: 4, border: '1px solid #2a2a2a',
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
                  flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                  fontSize: 14, fontWeight: 500, cursor: 'pointer',
                  backgroundColor: (t === 'transfer' ? isTransferMode : (!isTransferMode && formType === t)) ? '#27272a' : 'transparent',
                  color: (t === 'transfer' ? isTransferMode : (!isTransferMode && formType === t)) 
                    ? (t === 'expense' ? '#f87171' : t === 'income' ? '#4ade80' : '#60a5fa') 
                    : '#9ca3af',
                  boxShadow: (t === 'transfer' ? isTransferMode : (!isTransferMode && formType === t)) ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                  transition: 'all 0.2s ease',
                }}>
                  {t === 'expense' ? '↓ Gasto' : t === 'income' ? '↑ Ingreso' : '↔️ Transferencia'}
                </button>
              ))}
            </div>

            {/* Account or Transfer accounts */}
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
                      <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 4 }}>
                        💱 Tipo de cambio: 1 USD = {(exchangeRate / 100).toFixed(2)} CLP
                      </div>
                    )}
                  </div>
                )}
                
                {/* Transfer: Note (optional) */}
                <div>
                  <label style={labelStyle}>Nota de transferencia (opcional)</label>
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
              <div>
                <label style={labelStyle}>Cuenta</label>
                <select value={formAccountId} onChange={e => setFormAccountId(e.target.value)} style={selectStyle}>
                  <option value="">Sin cuenta</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.emoji || '🏦'} {a.bankName} · {a.accountType} · ···{a.lastFourDigits}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Name */}
            <div>
              <label style={labelStyle}>Descripción</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} autoFocus style={inputStyle} />
            </div>

            {/* Amount + Currency */}
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 2 }}>
                <label style={labelStyle}>{formCurrency === 'USD' ? 'Monto pesos' : 'Monto'}</label>
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

            {/* Date + Time */}
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 2 }}>
                <label style={labelStyle}>Fecha</label>
                <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                  style={{ ...inputStyle, colorScheme: 'dark' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Hora</label>
                <input type="time" value={formTime} onChange={e => setFormTime(e.target.value)}
                  style={{ ...inputStyle, colorScheme: 'dark' }} />
              </div>
            </div>

            {/* Original Name (read-only) */}
            {movement.originalName && (
              <div>
                <label style={labelStyle}>Nombre original</label>
                <div style={{
                  padding: '12px 14px', borderRadius: 12, backgroundColor: '#111',
                  border: '1px solid #2a2a2a', fontSize: 14, color: '#a1a1aa',
                }}>
                  {movement.originalName}
                </div>
              </div>
            )}

            {/* Category (hidden in transfer mode) */}
            {!isTransferMode && (
              <div>
                <label style={labelStyle}>Categoría</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={formCategoryId} onChange={e => setFormCategoryId(e.target.value)} style={{ ...selectStyle, flex: 1 }}>
                    <option value="">Sin categoría</option>
                    {localCategories.map(c => (
                      <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
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
            )}

            {/* Emergency expense checkbox (only for expenses, not transfers) */}
            {!isTransferMode && formType === 'expense' && (
              <label style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                backgroundColor: formEmergency ? '#2a1a1a' : 'transparent',
                border: formEmergency ? '1px solid #dc2626' : '1px solid #2a2a2a',
                transition: 'all 0.2s ease',
              }}>
                <input
                  type="checkbox"
                  checked={formEmergency}
                  onChange={e => handleToggleEmergency(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: '#dc2626', cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: formEmergency ? '#f87171' : '#e5e5e5' }}>
                    🚨 Gasto de emergencia
                  </div>
                  <div style={{ fontSize: 11, color: '#a1a1aa' }}>
                    No cuenta en reportes regulares. Se puede saldar parcialmente.
                  </div>
                </div>
              </label>
            )}

            {/* Loan income checkbox (only for incomes, not transfers) */}
            {!isTransferMode && formType === 'income' && (
              <label style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                backgroundColor: formLoan ? '#221933' : 'transparent',
                border: formLoan ? '1px solid #8b5cf6' : '1px solid #2a2a2a',
                transition: 'all 0.2s ease',
              }}>
                <input
                  type="checkbox"
                  checked={formLoan}
                  onChange={e => handleToggleLoan(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: '#8b5cf6', cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: formLoan ? '#c4b5fd' : '#e5e5e5' }}>
                    💵 Préstamo
                  </div>
                  <div style={{ fontSize: 11, color: '#a1a1aa' }}>
                    Ingreso que debes devolver después. No cuenta como ingreso en reportes.
                  </div>
                </div>
              </label>
            )}
          </div>
        </div>

        {/* Save button */}
        <div style={{ marginTop: 20 }}>
          <button onClick={handleSave} disabled={loading} style={{
            width: '100%', height: 48, borderRadius: 12, border: 'none',
            background: loading ? '#27272a' : isTransferMode 
              ? 'linear-gradient(135deg, #3b82f6, #2563eb)'
              : 'linear-gradient(135deg, #22c55e, #16a34a)',
            color: '#fff', fontSize: 15, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            boxShadow: loading ? 'none' : isTransferMode 
              ? '0 4px 12px rgba(59,130,246,0.3)'
              : '0 4px 12px rgba(34,197,94,0.3)',
          }}>
            {loading ? 'Guardando...' : isTransferMode ? '↔️ Convertir a Transferencia' : 'Guardar cambios ✓'}
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
          {movement.receivable ? (
            <button onClick={async () => {
              setLoading(true)
              try {
                await unmarkReceivable(movement.id)
                router.push('/')
              } catch { setError('Error al desmarcar') }
              finally { setLoading(false) }
            }} disabled={loading} style={{
              flex: 1, height: 42, borderRadius: 12, border: '1px solid #854d0e',
              backgroundColor: '#422006', color: '#fbbf24',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}>
              💰 Desmarcar cobro
            </button>
          ) : (
            <button onClick={() => { setShowReceivable(true); setReceivableText(movement.name) }} disabled={loading} style={{
              flex: 1, height: 42, borderRadius: 12, border: '1px solid #854d0e',
              backgroundColor: '#1a1a1a', color: '#fbbf24',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}>
              💰 Por cobrar
            </button>
          )}
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

        <CreateCategoryDialog
          open={showCreateCategory}
          onClose={() => setShowCreateCategory(false)}
          onCreated={(id, name, emoji) => {
            setLocalCategories(prev => [...prev, { id, name, emoji, userId: '', createdAt: new Date(), updatedAt: new Date() }])
            setFormCategoryId(id)
          }}
        />

        {/* Split dialog */}
        {showSplit && (
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
                Total: <strong style={{ color: '#e5e5e5' }}>{formatMovementDisplayAmount(movement.amount, movement.amountUsd, movement.currency)}</strong>
                {' · '}{movement.name}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {splitItems.map((item, idx) => (
                  <div key={idx} style={{
                    display: 'flex', gap: 8, alignItems: 'center',
                    padding: '10px 12px', backgroundColor: idx === 0 ? '#1a2a1a' : '#111',
                    borderRadius: 10, border: '1px solid #2a2a2a',
                  }}>
                    <span style={{ fontSize: 13, color: '#a1a1aa', width: 20, flexShrink: 0 }}>{idx + 1}</span>
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
                        ...(idx === 0 ? { backgroundColor: '#0a0a0a', color: '#a1a1aa' } : {}),
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
