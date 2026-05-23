'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { updateTransfer, deleteTransfer, getCurrentExchangeRate } from '@/lib/actions/transfers'
import { parseMoney } from '@/lib/utils'
import type { Account } from '@/lib/db'

interface TransferMovement {
  id: string
  accountId: string | null
  name: string
  date: string
  amount: number
  type: 'income' | 'expense'
  currency: 'CLP' | 'USD'
  amountUsd: number | null
  exchangeRate: number | null
  spaceId: string
  accountBankName: string | null
  accountLastFour: string | null
  accountCurrency: 'CLP' | 'USD' | null
  accountEmoji: string | null
}

interface TransferData {
  transferId: string
  sourceSpaceId: string
  destinationSpaceId: string
  canEdit: boolean
  fromMovement: TransferMovement
  toMovement: TransferMovement
}

interface Props {
  transfer: TransferData
  accounts: Account[]
  transferAccounts: Account[]
  transferSpaces: { id: string; name: string; emoji: string; isCurrent: boolean; hasAccounts: boolean }[]
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 48, borderRadius: 12,
  border: '1px solid #2a2a2a', backgroundColor: '#1a1a1a',
  fontSize: 15, color: '#e5e5e5', padding: '0 14px', outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = { fontSize: 13, color: '#a1a1aa', marginBottom: 6, display: 'block' }
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2371717a' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
  backgroundPosition: 'right 12px center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '16px',
}

function centsToDisplay(cents: number): string {
  return (cents / 100).toString()
}

function extractTransferNote(name: string): string {
  return name.includes(' · ') ? name.split(' · ').slice(1).join(' · ') : ''
}

export function EditTransferClient({ transfer, accounts, transferAccounts, transferSpaces }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [formFromAccountId, setFormFromAccountId] = useState(transfer.fromMovement.accountId ?? '')
  const [formDestinationSpaceId, setFormDestinationSpaceId] = useState(transfer.destinationSpaceId)
  const [formToAccountId, setFormToAccountId] = useState(transfer.toMovement.accountId ?? '')
  const sourceAccounts = transferAccounts.filter(a => a.spaceId === transfer.sourceSpaceId)
  const destinationAccounts = transferAccounts.filter(a => a.spaceId === formDestinationSpaceId)
  const selectedDestinationSpace = transferSpaces.find(s => s.id === formDestinationSpaceId)
  const fromAccount = sourceAccounts.find(a => a.id === formFromAccountId) || accounts.find(a => a.id === transfer.fromMovement.accountId)
  const toAccount = destinationAccounts.find(a => a.id === formToAccountId) || transferAccounts.find(a => a.id === transfer.toMovement.accountId)

  const fromCurrency = fromAccount?.currency || transfer.fromMovement.accountCurrency || transfer.fromMovement.currency
  const toCurrency = toAccount?.currency || transfer.toMovement.accountCurrency || transfer.toMovement.currency
  const currenciesDiffer = fromCurrency !== toCurrency

  // Form state
  const [formDate, setFormDate] = useState(transfer.fromMovement.date)
  const [formNote, setFormNote] = useState(extractTransferNote(transfer.fromMovement.name))
  const [formFromAmount, setFormFromAmount] = useState(
    fromCurrency === 'USD' && transfer.fromMovement.amountUsd
      ? centsToDisplay(transfer.fromMovement.amountUsd)
      : centsToDisplay(transfer.fromMovement.amount)
  )
  const [formToAmount, setFormToAmount] = useState(
    toCurrency === 'USD' && transfer.toMovement.amountUsd
      ? centsToDisplay(transfer.toMovement.amountUsd)
      : centsToDisplay(transfer.toMovement.amount)
  )
  const [exchangeRate, setExchangeRate] = useState<number | null>(null)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    if (formDestinationSpaceId !== transfer.destinationSpaceId) setFormToAccountId('')
  }, [formDestinationSpaceId, transfer.destinationSpaceId])

  // Get exchange rate
  useEffect(() => {
    getCurrentExchangeRate().then(setExchangeRate).catch(() => {})
  }, [])

  // Auto-calculate toAmount when fromAmount changes (for different currencies)
  useEffect(() => {
    if (currenciesDiffer && formFromAmount && exchangeRate) {
      const fromCents = parseMoney(formFromAmount)
      if (fromCents > 0) {
        let toCents: number
        if (fromCurrency === 'USD' && toCurrency === 'CLP') {
          toCents = Math.round(fromCents * exchangeRate / 100)
        } else if (fromCurrency === 'CLP' && toCurrency === 'USD') {
          toCents = Math.round(fromCents * 100 / exchangeRate)
        } else {
          toCents = fromCents
        }
        setFormToAmount((toCents / 100).toString())
      }
    }
  }, [formFromAmount, fromCurrency, toCurrency, currenciesDiffer, exchangeRate])

  async function handleSave() {
    setLoading(true)
    setError(null)
    try {
      const fromCents = parseMoney(formFromAmount)
      const toCents = currenciesDiffer ? parseMoney(formToAmount) : fromCents

      if (fromCents <= 0) {
        setError('El monto origen debe ser mayor a 0')
        setLoading(false)
        return
      }
      if (currenciesDiffer && toCents <= 0) {
        setError('El monto destino debe ser mayor a 0')
        setLoading(false)
        return
      }
      if (!formFromAccountId || !formToAccountId) {
        setError(selectedDestinationSpace?.hasAccounts === false ? 'El Space destino no tiene cuentas disponibles' : 'Selecciona las cuentas de la transferencia')
        setLoading(false)
        return
      }
      if (formFromAccountId === formToAccountId && transfer.sourceSpaceId === formDestinationSpaceId) {
        setError('Las cuentas deben ser diferentes')
        setLoading(false)
        return
      }

      const result = await updateTransfer(transfer.transferId, {
        fromAccountId: formFromAccountId,
        toAccountId: formToAccountId,
        destinationSpaceId: formDestinationSpaceId,
        fromAmount: fromCents,
        toAmount: toCents,
        fromCurrency,
        toCurrency,
        date: formDate,
        note: formNote.trim() || undefined,
      })

      if (!result.success) {
        setError(result.error || 'Error al guardar')
      } else {
        router.push('/')
      }
    } catch {
      setError('Error al guardar')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    setLoading(true)
    setError(null)
    try {
      const result = await deleteTransfer(transfer.transferId)
      if (!result.success) {
        setError(result.error || 'Error al eliminar')
        setLoading(false)
        return
      }
      setShowDeleteConfirm(false)
      router.push('/')
    } catch {
      setError('Error al eliminar')
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
          <span style={{ fontSize: 17, fontWeight: 700, color: '#f5f5f5' }}>Editar Transferencia</span>
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
        {!transfer.canEdit && (
          <div style={{ backgroundColor: '#422006', border: '1px solid #854d0e', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: 14, color: '#facc15' }}>
            Necesitas acceso a ambos Spaces para editar o eliminar esta transferencia.
          </div>
        )}

        {/* Transfer Info Card */}
        <div style={{
          backgroundColor: '#1a1a2a', borderRadius: 16, padding: 20,
          border: '1px solid #3b4d8a', marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 24 }}>↔️</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#60a5fa' }}>Transferencia entre cuentas</div>
              <div style={{ fontSize: 12, color: '#a1a1aa' }}>
                {fromAccount?.emoji || '🏦'} {fromAccount?.bankName} → {toAccount?.emoji || '🏦'} {toAccount?.bankName}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Cuenta origen</label>
              <select aria-label="Cuenta origen" value={formFromAccountId} onChange={e => setFormFromAccountId(e.target.value)} style={selectStyle} disabled={!transfer.canEdit}>
                {sourceAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.emoji || '🏦'} {a.bankName} ···{a.lastFourDigits} ({a.currency})</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Space destino</label>
              <select aria-label="Space destino" value={formDestinationSpaceId} onChange={e => setFormDestinationSpaceId(e.target.value)} style={selectStyle} disabled={!transfer.canEdit}>
                {transferSpaces.map(space => (
                  <option key={space.id} value={space.id} disabled={!space.hasAccounts}>
                    {space.emoji} {space.name}{space.isCurrent ? ' (actual)' : ''}{!space.hasAccounts ? ' — sin cuentas' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Cuenta destino</label>
              <select aria-label="Cuenta destino" value={formToAccountId} onChange={e => setFormToAccountId(e.target.value)} style={selectStyle} disabled={!transfer.canEdit}>
                <option value="">{destinationAccounts.length === 0 ? 'Space sin cuentas disponibles' : 'Seleccionar cuenta destino'}</option>
                {destinationAccounts.filter(a => formDestinationSpaceId !== transfer.sourceSpaceId || a.id !== formFromAccountId).map(a => (
                  <option key={a.id} value={a.id}>{a.emoji || '🏦'} {a.bankName} ···{a.lastFourDigits} ({a.currency})</option>
                ))}
              </select>
            </div>

            {/* Amounts */}
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Monto desde ({fromCurrency})</label>
                <input
                  value={formFromAmount}
                  onChange={e => setFormFromAmount(e.target.value)}
                  inputMode="decimal"
                  style={inputStyle}
                />
              </div>
              {currenciesDiffer && (
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Monto hacia ({toCurrency})</label>
                  <input
                    value={formToAmount}
                    onChange={e => setFormToAmount(e.target.value)}
                    inputMode="decimal"
                    style={inputStyle}
                  />
                </div>
              )}
            </div>

            {/* Exchange rate hint */}
            {currenciesDiffer && exchangeRate && (
              <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: -8 }}>
                💱 Tipo de cambio: 1 USD = {(exchangeRate / 100).toFixed(2)} CLP
              </div>
            )}

            {/* Date */}
            <div>
              <label style={labelStyle}>Fecha</label>
              <input
                type="date"
                value={formDate}
                onChange={e => setFormDate(e.target.value)}
                style={{ ...inputStyle, colorScheme: 'dark' }}
              />
            </div>

            {/* Note */}
            <div>
              <label style={labelStyle}>Nota (opcional)</label>
              <input
                value={formNote}
                onChange={e => setFormNote(e.target.value)}
                placeholder="ej: Pago tarjeta de crédito"
                style={inputStyle}
              />
            </div>
          </div>
        </div>

        {/* Save button */}
        <div style={{ marginTop: 20 }}>
          <button onClick={handleSave} disabled={loading || !transfer.canEdit} style={{
            width: '100%', height: 48, borderRadius: 12, border: 'none',
            background: loading ? '#27272a' : 'linear-gradient(135deg, #3b82f6, #2563eb)',
            color: '#fff', fontSize: 15, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            boxShadow: loading ? 'none' : '0 4px 12px rgba(59,130,246,0.3)',
          }}>
            {loading ? 'Guardando...' : 'Guardar cambios ✓'}
          </button>
        </div>

        {/* Delete button */}
        <div style={{ marginTop: 12 }}>
          <button onClick={() => setShowDeleteConfirm(true)} disabled={loading || !transfer.canEdit} style={{
            width: '100%', height: 42, borderRadius: 12, border: '1px solid #7f1d1d',
            backgroundColor: '#1a1a1a', color: '#f87171',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            🗑 Eliminar transferencia
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
                ¿Eliminar esta transferencia?
              </div>
              <div style={{ fontSize: 14, color: '#a1a1aa', marginBottom: 20 }}>
                Se eliminarán ambos movimientos (salida y entrada). Esta acción no se puede deshacer.
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
      </main>
    </>
  )
}
