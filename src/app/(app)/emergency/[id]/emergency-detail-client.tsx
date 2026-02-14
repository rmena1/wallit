'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { settleEmergencyPartial, type EmergencyPaymentDetail } from '@/lib/actions/emergency'
import { formatCurrency, formatDateDisplay, parseMoney, today } from '@/lib/utils'

interface EmergencyData {
  id: string
  name: string
  amount: number
  date: string
  currency: 'CLP' | 'USD'
  accountId: string | null
  accountBankName: string | null
  accountEmoji: string | null
  emergencySettled: boolean
  totalPaid: number
  remaining: number
  payments: EmergencyPaymentDetail[]
}

interface AccountInfo {
  id: string
  bankName: string
  lastFourDigits: string
  emoji: string | null
}

interface Props {
  emergency: EmergencyData
  accounts: AccountInfo[]
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

export function EmergencyDetailClient({ emergency, accounts }: Props) {
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [fromAccountId, setFromAccountId] = useState(accounts[0]?.id || '')
  const [toAccountId, setToAccountId] = useState(emergency.accountId || accounts[0]?.id || '')
  const [payAmount, setPayAmount] = useState((emergency.remaining / 100).toString())
  const [payDate, setPayDate] = useState(today())

  const sameAccount = fromAccountId === toAccountId
  const progress = emergency.amount > 0 ? Math.min(100, (emergency.totalPaid / emergency.amount) * 100) : 0

  async function handleSettle() {
    setLoading(true)
    setError(null)
    try {
      const amountCents = parseMoney(payAmount)
      if (amountCents <= 0) { setError('Monto inválido'); setLoading(false); return }

      const result = await settleEmergencyPartial(emergency.id, fromAccountId, toAccountId, amountCents, payDate)
      if (!result.success) {
        setError(result.error || 'Error al abonar')
        setLoading(false)
        return
      }
      setShowModal(false)
      router.refresh()
    } catch {
      setError('Error al procesar el abono')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <header style={{
        backgroundColor: '#111111', borderBottom: '1px solid #1e1e1e',
        padding: '12px 16px', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: 540, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => router.push('/emergency')} style={{
            background: 'none', border: 'none', color: '#a1a1aa',
            fontSize: 15, cursor: 'pointer', padding: '4px 0',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Volver
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#f5f5f5' }}>🚨 Emergencia</span>
          <div style={{ width: 60 }} />
        </div>
      </header>

      <main style={{ maxWidth: 540, margin: '0 auto', padding: '16px 16px 96px' }}>
        {/* Emergency details card */}
        <div style={{
          backgroundColor: '#1a1a1a', borderRadius: 16, padding: 20,
          border: '1px solid #dc262640', marginBottom: 16,
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#e5e5e5', marginBottom: 4 }}>
            {emergency.name}
          </div>
          <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 12 }}>
            {formatDateDisplay(emergency.date)}
            {emergency.accountBankName && <span> · {emergency.accountEmoji || '🏦'} {emergency.accountBankName}</span>}
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 2 }}>Total</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#f87171' }}>
                {formatCurrency(emergency.amount, emergency.currency)}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 2 }}>Pagado</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#4ade80' }}>
                {formatCurrency(emergency.totalPaid, emergency.currency)}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 2 }}>Restante</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#fbbf24' }}>
                {formatCurrency(emergency.remaining, emergency.currency)}
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ height: 8, borderRadius: 4, backgroundColor: '#27272a', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4,
              backgroundColor: progress >= 100 ? '#4ade80' : '#f59e0b',
              width: `${progress}%`,
              transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 4, textAlign: 'right' }}>
            {progress.toFixed(0)}% saldado
          </div>

          {!emergency.emergencySettled && (
            <button onClick={() => { setShowModal(true); setPayAmount((emergency.remaining / 100).toString()); setPayDate(today()); setError(null) }} style={{
              width: '100%', height: 48, borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              color: '#fff', fontSize: 15, fontWeight: 600,
              cursor: 'pointer', marginTop: 16,
              boxShadow: '0 4px 12px rgba(245,158,11,0.3)',
            }}>
              💰 Abonar
            </button>
          )}

          {emergency.emergencySettled && (
            <div style={{
              padding: '12px 16px', borderRadius: 12,
              backgroundColor: '#052e16', border: '1px solid #16a34a',
              color: '#4ade80', fontSize: 14, fontWeight: 600,
              textAlign: 'center', marginTop: 16,
            }}>
              ✅ Gasto de emergencia completamente saldado
            </div>
          )}
        </div>

        {/* Payments list */}
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#e5e5e5', margin: '0 0 10px' }}>
            Abonos ({emergency.payments.length})
          </h2>
          {emergency.payments.length === 0 ? (
            <div style={{
              backgroundColor: '#1a1a1a', borderRadius: 12, padding: '24px 16px',
              textAlign: 'center', color: '#a1a1aa', fontSize: 13,
              border: '1px solid #2a2a2a',
            }}>
              Sin abonos aún
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {emergency.payments.map(p => (
                <div key={p.id} style={{
                  backgroundColor: '#1a1a1a', borderRadius: 12, padding: '12px 14px',
                  border: '1px solid #2a2a2a',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 14, color: '#e5e5e5' }}>
                      {p.fromAccountEmoji || '🏦'} {p.fromAccountName || 'Cuenta'}
                      {p.fromAccountId !== p.toAccountId && (
                        <span> → {p.toAccountEmoji || '🏦'} {p.toAccountName || 'Cuenta'}</span>
                      )}
                      {p.fromAccountId === p.toAccountId && (
                        <span style={{ fontSize: 11, color: '#a1a1aa' }}> (tracking)</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 2 }}>
                      {formatDateDisplay(p.date)}
                    </div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#4ade80' }}>
                    {formatCurrency(p.amount, emergency.currency)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Payment modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 50, padding: 16,
        }}>
          <div style={{
            backgroundColor: '#1a1a1a', borderRadius: 16, padding: 24,
            border: '1px solid #2a2a2a', maxWidth: 400, width: '100%',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fbbf24', marginBottom: 16 }}>
              💰 Abonar a emergencia
            </div>

            {error && (
              <div style={{
                backgroundColor: '#450a0a', border: '1px solid #7f1d1d',
                borderRadius: 12, padding: '10px 14px', marginBottom: 12,
                fontSize: 13, color: '#fca5a5',
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Desde cuenta</label>
                <select value={fromAccountId} onChange={e => setFromAccountId(e.target.value)} style={selectStyle}>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.emoji || '🏦'} {a.bankName} ···{a.lastFourDigits}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Hacia cuenta</label>
                <select value={toAccountId} onChange={e => setToAccountId(e.target.value)} style={selectStyle}>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.emoji || '🏦'} {a.bankName} ···{a.lastFourDigits}</option>
                  ))}
                </select>
              </div>

              {sameAccount && (
                <div style={{
                  padding: '8px 12px', borderRadius: 8,
                  backgroundColor: '#1a1a2e', border: '1px solid #3b4d8a',
                  fontSize: 12, color: '#60a5fa',
                }}>
                  ℹ️ Solo tracking, sin transferencia
                </div>
              )}

              <div>
                <label style={labelStyle}>Monto</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Fecha</label>
                <input
                  type="date"
                  value={payDate}
                  onChange={e => setPayDate(e.target.value)}
                  style={{ ...inputStyle, colorScheme: 'dark' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button onClick={() => setShowModal(false)} style={{
                flex: 1, height: 44, borderRadius: 12, border: '1px solid #2a2a2a',
                backgroundColor: '#27272a', color: '#a1a1aa',
                fontSize: 15, fontWeight: 600, cursor: 'pointer',
              }}>
                Cancelar
              </button>
              <button onClick={handleSettle} disabled={loading} style={{
                flex: 1, height: 44, borderRadius: 12, border: 'none',
                backgroundColor: loading ? '#27272a' : '#d97706',
                color: '#fff', fontSize: 15, fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}>
                {loading ? 'Procesando...' : 'Confirmar abono'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
