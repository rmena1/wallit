'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { recordReportableMovement } from '@/lib/actions/movements'
import { recordTransfer, getCurrentExchangeRate } from '@/lib/actions/transfers'
import { today, parseMoney } from '@/lib/utils'
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

const inputErrorStyle: React.CSSProperties = {
  ...inputStyle,
  border: '1px solid #dc2626',
  backgroundColor: '#1a1010',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2371717a' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
  backgroundPosition: 'right 12px center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '16px',
}

const selectErrorStyle: React.CSSProperties = {
  ...selectStyle,
  border: '1px solid #dc2626',
  backgroundColor: '#1a1010',
}

const errorTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#f87171',
  marginTop: 4,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}

interface FieldErrors {
  accountId?: string
  fromAccountId?: string
  toAccountId?: string
  name?: string
  amount?: string
  fromAmount?: string
  toAmount?: string
  date?: string
}

type MovementType = 'expense' | 'income' | 'transfer'

export function AddMovementPage({ accounts, categories }: AddMovementPageProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [currency, setCurrency] = useState<'CLP' | 'USD'>('CLP')
  const [showCreateCategory, setShowCreateCategory] = useState(false)
  const [localCategories, setLocalCategories] = useState(categories)
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  
  // Common form state
  const [date, setDate] = useState(today())
  const [time, setTime] = useState('')
  const [type, setType] = useState<MovementType>('expense')

  // Movement form state
  const [accountId, setAccountId] = useState('')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [emergency, setEmergency] = useState(false)

  // Transfer form state
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [fromAmount, setFromAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [note, setNote] = useState('')
  const [exchangeRate, setExchangeRate] = useState<number | null>(null)

  // Get currencies for selected accounts
  const fromAccount = accounts.find(a => a.id === fromAccountId)
  const toAccount = accounts.find(a => a.id === toAccountId)
  const fromCurrency = fromAccount?.currency || 'CLP'
  const toCurrency = toAccount?.currency || 'CLP'
  const currenciesDiffer = fromCurrency !== toCurrency

  useEffect(() => {
    if (type !== 'expense' && emergency) setEmergency(false)
  }, [type, emergency])

  // Load exchange rate only when the transfer form actually needs currency conversion.
  // Fetching it on every add-page visit can block the UI on slow/offline networks.
  useEffect(() => {
    if (type !== 'transfer' || !currenciesDiffer) {
      setExchangeRate(null)
      return
    }

    let cancelled = false
    getCurrentExchangeRate()
      .then(rate => { if (!cancelled) setExchangeRate(rate) })
      .catch(() => { if (!cancelled) setExchangeRate(null) })

    return () => { cancelled = true }
  }, [type, currenciesDiffer])

  // Auto-calculate toAmount when fromAmount changes (for different currencies)
  useEffect(() => {
    if (type === 'transfer' && currenciesDiffer && fromAmount && exchangeRate) {
      const fromCents = parseMoney(fromAmount)
      if (fromCents > 0) {
        let toCents: number
        if (fromCurrency === 'USD' && toCurrency === 'CLP') {
          // USD to CLP: multiply by rate
          toCents = Math.round(fromCents * exchangeRate / 100)
        } else if (fromCurrency === 'CLP' && toCurrency === 'USD') {
          // CLP to USD: divide by rate
          toCents = Math.round(fromCents * 100 / exchangeRate)
        } else {
          toCents = fromCents
        }
        setToAmount((toCents / 100).toString())
      }
    } else if (type === 'transfer' && !currenciesDiffer && fromAmount) {
      // Same currency: copy amount
      setToAmount(fromAmount)
    }
  }, [fromAmount, fromCurrency, toCurrency, currenciesDiffer, exchangeRate, type])

  function validateMovementForm(): boolean {
    const errors: FieldErrors = {}
    
    if (!accountId) {
      errors.accountId = 'Selecciona una cuenta'
    }
    if (!name.trim()) {
      errors.name = 'Ingresa una descripción'
    }
    if (!amount.trim()) {
      errors.amount = 'Ingresa un monto'
    } else {
      const cents = parseMoney(amount)
      if (cents <= 0) {
        errors.amount = 'El monto debe ser mayor a 0'
      }
    }
    if (!date) {
      errors.date = 'Selecciona una fecha'
    }
    
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  function validateTransferForm(): boolean {
    const errors: FieldErrors = {}
    
    if (!fromAccountId) {
      errors.fromAccountId = 'Selecciona cuenta origen'
    }
    if (!toAccountId) {
      errors.toAccountId = 'Selecciona cuenta destino'
    }
    if (fromAccountId && toAccountId && fromAccountId === toAccountId) {
      errors.toAccountId = 'Debe ser diferente a la cuenta origen'
    }
    if (!fromAmount.trim()) {
      errors.fromAmount = 'Ingresa un monto'
    } else {
      const cents = parseMoney(fromAmount)
      if (cents <= 0) {
        errors.fromAmount = 'El monto debe ser mayor a 0'
      }
    }
    if (currenciesDiffer && !toAmount.trim()) {
      errors.toAmount = 'Ingresa monto destino'
    } else if (currenciesDiffer) {
      const cents = parseMoney(toAmount)
      if (cents <= 0) {
        errors.toAmount = 'El monto debe ser mayor a 0'
      }
    }
    if (!date) {
      errors.date = 'Selecciona una fecha'
    }
    
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  function clearFieldError(field: keyof FieldErrors) {
    if (fieldErrors[field]) {
      setFieldErrors(prev => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    
    if (type === 'transfer') {
      if (!validateTransferForm()) return
      
      setLoading(true)
      try {
        const fromCents = parseMoney(fromAmount)
        const toCents = currenciesDiffer ? parseMoney(toAmount) : fromCents
        
        const result = await recordTransfer({
          fromAccountId,
          toAccountId,
          fromAmount: fromCents,
          toAmount: toCents,
          fromCurrency,
          toCurrency,
          date,
          note: note.trim() || undefined,
        })
        
        if (!result.success) {
          setError(result.error || 'Error al crear transferencia')
        } else {
          router.push('/')
        }
      } catch {
        setError('Ocurrió un error')
      } finally {
        setLoading(false)
      }
    } else {
      // Normal movement
      if (!validateMovementForm()) return
      
      setLoading(true)
      try {
        const formData = new FormData()
        formData.set('type', type)
        formData.set('accountId', accountId)
        formData.set('name', name)
        formData.set('amount', parseMoney(amount).toString())
        formData.set('currency', currency)
        formData.set('amountInputMode', 'inputCurrency')
        formData.set('date', date)
        if (time) formData.set('time', time)
        if (selectedCategoryId) formData.set('categoryId', selectedCategoryId)
        if (type === 'expense' && emergency) formData.set('emergency', 'true')
        
        const result = await recordReportableMovement(formData)
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
          <span style={{ fontSize: 17, fontWeight: 700, color: '#f5f5f5' }}>
            {type === 'transfer' ? 'Nueva Transferencia' : 'Nuevo Movimiento'}
          </span>
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

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Type Toggle - 3 options */}
            <div style={{
              display: 'flex', backgroundColor: '#1a1a1a', borderRadius: 12,
              padding: 4, gap: 4, border: '1px solid #2a2a2a',
            }}>
              {(['expense', 'income', 'transfer'] as const).map((t) => {
                const selected = type === t
                return (
                  <button
                    key={t}
                    type="button"
                    aria-label={t === 'expense' ? '↓ Gasto' : t === 'income' ? '↑ Ingreso' : '↔️ Transferencia'}
                    aria-pressed={selected}
                    onClick={() => setType(t)}
                    style={{
                      flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                      fontSize: 14, fontWeight: 500, cursor: 'pointer',
                      backgroundColor: selected ? '#27272a' : 'transparent',
                      color: selected
                        ? (t === 'expense' ? '#f87171' : t === 'income' ? '#4ade80' : '#60a5fa')
                        : '#52525b',
                      boxShadow: selected ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {t === 'expense' ? '↓ Gasto' : t === 'income' ? '↑ Ingreso' : '↔️ Transferencia'}
                  </button>
                )
              })}
            </div>

            {type === 'transfer' ? (
              /* ===== TRANSFER FORM ===== */
              <>
                {/* From Account */}
                <div>
                  <label htmlFor="add-transfer-from-account" style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>Desde cuenta</label>
                  <select 
                    id="add-transfer-from-account"
                    aria-label="Desde cuenta"
                    value={fromAccountId} 
                    onChange={e => { setFromAccountId(e.target.value); clearFieldError('fromAccountId') }}
                    style={fieldErrors.fromAccountId ? selectErrorStyle : selectStyle}
                  >
                    <option value="" disabled>Seleccionar cuenta origen</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.emoji || '🏦'} {acc.bankName} · {acc.accountType} · ···{acc.lastFourDigits} ({acc.currency})
                      </option>
                    ))}
                  </select>
                  {fieldErrors.fromAccountId && (
                    <div style={errorTextStyle}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      {fieldErrors.fromAccountId}
                    </div>
                  )}
                </div>

                {/* To Account */}
                <div>
                  <label htmlFor="add-transfer-to-account" style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>Hacia cuenta</label>
                  <select 
                    id="add-transfer-to-account"
                    aria-label="Hacia cuenta"
                    value={toAccountId} 
                    onChange={e => { setToAccountId(e.target.value); clearFieldError('toAccountId') }}
                    style={fieldErrors.toAccountId ? selectErrorStyle : selectStyle}
                  >
                    <option value="" disabled>Seleccionar cuenta destino</option>
                    {accounts.filter(a => a.id !== fromAccountId).map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.emoji || '🏦'} {acc.bankName} · {acc.accountType} · ···{acc.lastFourDigits} ({acc.currency})
                      </option>
                    ))}
                  </select>
                  {fieldErrors.toAccountId && (
                    <div style={errorTextStyle}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      {fieldErrors.toAccountId}
                    </div>
                  )}
                </div>

                {/* Amount(s) */}
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label htmlFor="add-transfer-from-amount" style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>
                      Monto origen {fromCurrency && `(${fromCurrency})`}
                    </label>
                    <input
                      id="add-transfer-from-amount"
                      aria-label="Monto origen"
                      type="text" 
                      placeholder="0.00"
                      inputMode="decimal" 
                      autoComplete="off"
                      value={fromAmount}
                      onChange={e => { setFromAmount(e.target.value); clearFieldError('fromAmount') }}
                      style={fieldErrors.fromAmount ? inputErrorStyle : inputStyle}
                    />
                    {fieldErrors.fromAmount && (
                      <div style={errorTextStyle}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"/>
                          <line x1="12" y1="8" x2="12" y2="12"/>
                          <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        {fieldErrors.fromAmount}
                      </div>
                    )}
                  </div>
                  {currenciesDiffer && (
                    <div style={{ flex: 1 }}>
                      <label htmlFor="add-transfer-to-amount" style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>
                        Monto destino ({toCurrency})
                      </label>
                      <input
                        id="add-transfer-to-amount"
                        aria-label="Monto destino"
                        type="text" 
                        placeholder="0.00"
                        inputMode="decimal" 
                        autoComplete="off"
                        value={toAmount}
                        onChange={e => { setToAmount(e.target.value); clearFieldError('toAmount') }}
                        style={fieldErrors.toAmount ? inputErrorStyle : inputStyle}
                      />
                      {fieldErrors.toAmount && (
                        <div style={errorTextStyle}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                          </svg>
                          {fieldErrors.toAmount}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Exchange rate hint */}
                {currenciesDiffer && exchangeRate && (
                  <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: -8 }}>
                    💱 Tipo de cambio: 1 USD = {(exchangeRate / 100).toFixed(2)} CLP
                    <span style={{ color: '#9ca3af' }}> (puedes ajustar el monto destino)</span>
                  </div>
                )}

                {/* Date */}
                <div>
                  <label htmlFor="add-transfer-date" style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>Fecha</label>
                  <input
                    id="add-transfer-date"
                    aria-label="Fecha"
                    type="date" 
                    value={date}
                    onChange={e => { setDate(e.target.value); clearFieldError('date') }}
                    style={{ ...(fieldErrors.date ? inputErrorStyle : inputStyle), colorScheme: 'dark' }}
                  />
                  {fieldErrors.date && (
                    <div style={errorTextStyle}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      {fieldErrors.date}
                    </div>
                  )}
                </div>

                {/* Note (optional) */}
                <div>
                  <label htmlFor="add-transfer-note" style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>Nota (opcional)</label>
                  <input
                    id="add-transfer-note"
                    aria-label="Nota"
                    type="text" 
                    placeholder="ej: Pago tarjeta de crédito"
                    autoComplete="off"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </>
            ) : (
              /* ===== NORMAL MOVEMENT FORM ===== */
              <>
                {/* Account selector */}
                <div>
                  <label htmlFor="add-movement-account" style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>Cuenta</label>
                  <select 
                    id="add-movement-account"
                    aria-label="Cuenta"
                    name="accountId"
                    value={accountId} 
                    onChange={e => { setAccountId(e.target.value); clearFieldError('accountId') }}
                    style={fieldErrors.accountId ? selectErrorStyle : selectStyle}
                  >
                    <option value="" disabled>Seleccionar cuenta</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.emoji || '🏦'} {acc.bankName} · {acc.accountType} · ···{acc.lastFourDigits}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.accountId && (
                    <div style={errorTextStyle}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      {fieldErrors.accountId}
                    </div>
                  )}
                </div>

                {/* Name */}
                <div>
                  <label htmlFor="add-movement-name" style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>Descripción</label>
                  <input
                    id="add-movement-name"
                    aria-label="Descripción"
                    type="text" 
                    placeholder="¿En qué se gastó?"
                    autoComplete="off"
                    value={name}
                    onChange={e => { setName(e.target.value); clearFieldError('name') }}
                    style={fieldErrors.name ? inputErrorStyle : inputStyle}
                  />
                  {fieldErrors.name && (
                    <div style={errorTextStyle}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      {fieldErrors.name}
                    </div>
                  )}
                </div>

                {/* Amount + Currency */}
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 2 }}>
                    <label htmlFor="add-movement-amount" style={{ fontSize: 13, color: '#71717a', marginBottom: 6, display: 'block' }}>{currency === 'USD' ? 'Monto (USD)' : 'Monto'}</label>
                    <input
                      id="add-movement-amount"
                      aria-label="Monto"
                      type="text" 
                      placeholder="0.00"
                      inputMode="decimal" 
                      autoComplete="off"
                      value={amount}
                      onChange={e => { setAmount(e.target.value); clearFieldError('amount') }}
                      style={fieldErrors.amount ? inputErrorStyle : inputStyle}
                    />
                    {fieldErrors.amount && (
                      <div style={errorTextStyle}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"/>
                          <line x1="12" y1="8" x2="12" y2="12"/>
                          <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        {fieldErrors.amount}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <label htmlFor="add-movement-currency" style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>Moneda</label>
                    <select id="add-movement-currency" name="currency" value={currency} onChange={e => setCurrency(e.target.value as 'CLP' | 'USD')} style={selectStyle}>
                      <option value="CLP">CLP</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                </div>
                
                {/* Date + Time */}
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 2 }}>
                    <label htmlFor="add-movement-date" style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>Fecha</label>
                    <input
                      id="add-movement-date"
                      type="date" 
                      value={date}
                      onChange={e => { setDate(e.target.value); clearFieldError('date') }}
                      style={{ ...(fieldErrors.date ? inputErrorStyle : inputStyle), colorScheme: 'dark' }}
                    />
                    {fieldErrors.date && (
                      <div style={errorTextStyle}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"/>
                          <line x1="12" y1="8" x2="12" y2="12"/>
                          <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        {fieldErrors.date}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <label htmlFor="add-movement-time" style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>Hora</label>
                    <input
                      id="add-movement-time"
                      aria-label="Hora"
                      name="time"
                      type="time"
                      value={time}
                      onChange={e => setTime(e.target.value)}
                      style={{ ...inputStyle, colorScheme: 'dark' }}
                    />
                  </div>
                </div>

                {/* Category */}
                <div>
                  <label htmlFor="add-movement-category" style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>Categoría</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select 
                      id="add-movement-category"
                      aria-label="Categoría"
                      name="categoryId" 
                      value={selectedCategoryId} 
                      onChange={e => setSelectedCategoryId(e.target.value)} 
                      style={{ 
                        ...selectStyle, 
                        flex: 1,
                        ...(selectedCategoryId === '' ? {
                          border: '1px solid #f59e0b40',
                          backgroundColor: '#1a1812',
                        } : {})
                      }}
                    >
                      <option value="">⚠️ Sin categoría</option>
                      {localCategories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.emoji} {cat.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" aria-label="Crear categoría" onClick={() => setShowCreateCategory(true)} style={{
                      width: 48, height: 48, borderRadius: 12, border: '1px solid #2a2a2a',
                      backgroundColor: '#1a1a1a', color: '#22c55e', fontSize: 20,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>+</button>
                  </div>
                  {selectedCategoryId === '' && (
                    <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>💡</span>
                      <span>Categoriza para mejor seguimiento en reportes</span>
                    </div>
                  )}
                </div>

                {/* Emergency expense checkbox (only for expenses) */}
                {type === 'expense' && (
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                    backgroundColor: emergency ? '#2a1a1a' : 'transparent',
                    border: emergency ? '1px solid #dc2626' : '1px solid #2a2a2a',
                    transition: 'all 0.2s ease',
                  }}>
                    <input
                      type="checkbox"
                      checked={emergency}
                      onChange={e => setEmergency(e.target.checked)}
                      style={{ width: 18, height: 18, accentColor: '#dc2626', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: emergency ? '#f87171' : '#e5e5e5' }}>
                        🚨 Gasto de emergencia
                      </div>
                      <div style={{ fontSize: 11, color: '#a1a1aa' }}>
                        No cuenta en reportes regulares. Se puede saldar parcialmente.
                      </div>
                    </div>
                  </label>
                )}
              </>
            )}

            <button
              type="submit" disabled={loading}
              style={{
                width: '100%', height: 48, borderRadius: 12, border: 'none',
                background: loading ? '#27272a' : type === 'transfer' 
                  ? 'linear-gradient(135deg, #3b82f6, #2563eb)' 
                  : 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: '#fff', fontSize: 16, fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                marginTop: 4,
                boxShadow: loading ? 'none' : type === 'transfer'
                  ? '0 4px 12px rgba(59,130,246,0.3)'
                  : '0 4px 12px rgba(34,197,94,0.3)',
              }}
            >
              {loading ? 'Guardando...' : type === 'transfer' ? 'Crear Transferencia' : 'Guardar Movimiento'}
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
        .type-radio:checked + .type-label-transfer {
          color: #60a5fa;
        }
      `}</style>
    </>
  )
}
