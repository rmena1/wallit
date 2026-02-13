'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDateDisplay, formatCurrency } from '@/lib/utils'
import { getAccountMovements } from '@/lib/actions/accounts'
import { updateInvestmentValue } from '@/lib/actions/investments'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'

interface AccountInfo {
  id: string
  bankName: string
  accountType: string
  lastFourDigits: string
  currency: 'CLP' | 'USD'
  color: string | null
  emoji: string | null
}

interface MovementRow {
  id: string
  name: string
  date: string
  amount: number
  type: 'income' | 'expense'
  currency: 'CLP' | 'USD'
  amountUsd: number | null
  time: string | null
  originalName: string | null
  receivable: boolean
  received: boolean
  categoryName: string | null
  categoryEmoji: string | null
}

interface BalancePoint {
  date: string
  balance: number
}

interface InvestmentSummary {
  totalDeposited: number
  gainLoss: number
  gainLossPercent: number
  currentValue: number
  currentValueUpdatedAt: Date | null
}

interface InvestmentSnapshot {
  id: string
  value: number
  date: string
  createdAt: Date
}

interface Props {
  account: AccountInfo
  balance: number
  movements: MovementRow[]
  balanceHistory?: BalancePoint[]
  totalCount: number
  hasMore: boolean
  investmentSummary: InvestmentSummary | null
  investmentSnapshots: InvestmentSnapshot[]
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function formatChartDate(dateStr: string) {
  const [, m, d] = dateStr.split('-')
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  return `${parseInt(d)} ${months[parseInt(m) - 1]}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div style={{
      backgroundColor: '#1a1a1a',
      border: '1px solid #2a2a2a',
      borderRadius: 10,
      padding: '8px 12px',
      fontSize: 13,
    }}>
      <div style={{ color: '#a1a1aa', marginBottom: 2 }}>{formatChartDate(point.date)}</div>
      <div style={{ color: point.balance >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>
        {formatCurrency(point.balance, point.currency || 'CLP')}
      </div>
    </div>
  )
}

export function AccountDetailClient({
  account,
  balance,
  movements: initialMovements,
  balanceHistory = [],
  totalCount,
  hasMore: initialHasMore,
  investmentSummary,
  investmentSnapshots,
}: Props) {
  const router = useRouter()
  const accentColor = account.color || '#3b82f6'
  const [movements, setMovements] = useState(initialMovements)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loadingMore, setLoadingMore] = useState(false)
  const [showUpdateForm, setShowUpdateForm] = useState(false)
  const [investmentValueInput, setInvestmentValueInput] = useState(
    investmentSummary ? String(investmentSummary.currentValue / 100) : ''
  )
  const [updatingValue, setUpdatingValue] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)

  async function handleLoadMore() {
    setLoadingMore(true)
    try {
      const more = await getAccountMovements(account.id, movements.length, 50)
      setMovements(prev => [...prev, ...more])
      if (movements.length + more.length >= totalCount) {
        setHasMore(false)
      }
    } finally {
      setLoadingMore(false)
    }
  }

  function formatUpdatedAt(date: Date | null) {
    if (!date) return 'Sin actualizacion'
    return new Date(date).toLocaleDateString('es-CL')
  }

  async function handleUpdateInvestmentValue() {
    const parsedValue = Number(investmentValueInput)
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      setUpdateError('Ingresa un valor valido')
      return
    }

    setUpdateError(null)
    setUpdatingValue(true)
    try {
      const valueCents = Math.round(parsedValue * 100)
      const result = await updateInvestmentValue(account.id, valueCents)
      if (!result.success) {
        setUpdateError(result.error || 'No se pudo actualizar el valor')
        return
      }

      setShowUpdateForm(false)
      router.refresh()
    } finally {
      setUpdatingValue(false)
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
        <div style={{ maxWidth: 540, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => router.push('/')}
            style={{
              width: 36, height: 36, borderRadius: 10,
              border: '1px solid #2a2a2a', backgroundColor: '#1a1a1a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#a1a1aa', cursor: 'pointer',
            }}
          >
            <BackIcon />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>{account.emoji || '🏦'}</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#f5f5f5' }}>{account.bankName}</div>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>{account.accountType} · ···{account.lastFourDigits}</div>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main style={{ maxWidth: 540, margin: '0 auto', padding: '16px 16px 96px' }}>
        {/* Investment Summary */}
        {investmentSummary && (
          <div style={{
            backgroundColor: '#1a1a2e',
            borderRadius: 16,
            border: '1px solid #2a2a4a',
            padding: '16px',
            marginBottom: 16,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 14,
            }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: '#ffffff', margin: 0 }}>
                Resumen de Inversion
              </h2>
              <button
                onClick={() => {
                  setShowUpdateForm(prev => !prev)
                  setInvestmentValueInput(String(investmentSummary.currentValue / 100))
                  setUpdateError(null)
                }}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid #3a3a58',
                  backgroundColor: '#0a0a0a',
                  color: '#e5e7eb',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {showUpdateForm ? 'Cancelar' : 'Update Value'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div style={{ backgroundColor: '#0a0a0a', borderRadius: 12, padding: '10px 12px', border: '1px solid #2a2a4a' }}>
                <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Current Value</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#ffffff' }}>
                  {formatCurrency(investmentSummary.currentValue, account.currency)}
                </div>
              </div>
              <div style={{ backgroundColor: '#0a0a0a', borderRadius: 12, padding: '10px 12px', border: '1px solid #2a2a4a' }}>
                <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Total Deposited</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#ffffff' }}>
                  {formatCurrency(investmentSummary.totalDeposited, account.currency)}
                </div>
              </div>
            </div>

            <div style={{
              backgroundColor: '#0a0a0a',
              borderRadius: 12,
              padding: '10px 12px',
              border: '1px solid #2a2a4a',
              marginBottom: 10,
            }}>
              <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Gain/Loss</div>
              <div style={{
                fontSize: 18,
                fontWeight: 700,
                color: investmentSummary.gainLoss >= 0 ? '#4ade80' : '#f87171',
              }}>
                {investmentSummary.gainLoss >= 0 ? '+' : '-'}
                {formatCurrency(Math.abs(investmentSummary.gainLoss), account.currency)}
                <span style={{ fontSize: 14, fontWeight: 600, marginLeft: 6 }}>
                  ({investmentSummary.gainLossPercent >= 0 ? '+' : ''}{investmentSummary.gainLossPercent.toFixed(2)}%)
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>
                Last updated: {formatUpdatedAt(investmentSummary.currentValueUpdatedAt)}
              </div>
            </div>

            {showUpdateForm && (
              <div style={{
                backgroundColor: '#0a0a0a',
                borderRadius: 12,
                border: '1px solid #2a2a4a',
                padding: '12px',
                marginBottom: 10,
              }}>
                <div style={{ fontSize: 12, color: '#d1d5db', marginBottom: 8 }}>Nuevo valor actual</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={investmentValueInput}
                    onChange={(e) => setInvestmentValueInput(e.target.value)}
                    style={{
                      flex: 1,
                      borderRadius: 10,
                      border: '1px solid #3a3a58',
                      backgroundColor: '#1a1a2e',
                      color: '#ffffff',
                      padding: '10px 12px',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                  <button
                    onClick={handleUpdateInvestmentValue}
                    disabled={updatingValue}
                    style={{
                      borderRadius: 10,
                      border: '1px solid #2a2a4a',
                      backgroundColor: updatingValue ? '#2a2a2a' : '#2563eb',
                      color: '#ffffff',
                      padding: '10px 12px',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: updatingValue ? 'not-allowed' : 'pointer',
                      opacity: updatingValue ? 0.8 : 1,
                    }}
                  >
                    {updatingValue ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
                {updateError && (
                  <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 8 }}>
                    {updateError}
                  </div>
                )}
              </div>
            )}

            <div style={{
              backgroundColor: '#0a0a0a',
              borderRadius: 12,
              border: '1px solid #2a2a4a',
              padding: '12px',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#f3f4f6', marginBottom: 8 }}>
                Investment Snapshots
              </div>
              {investmentSnapshots.length === 0 ? (
                <div style={{ fontSize: 12, color: '#9ca3af' }}>Sin snapshots registrados</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {investmentSnapshots.map((snapshot) => (
                    <div
                      key={snapshot.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 10px',
                        borderRadius: 10,
                        backgroundColor: '#1a1a2e',
                        border: '1px solid #2a2a4a',
                      }}
                    >
                      <span style={{ fontSize: 12, color: '#d1d5db' }}>{formatDateDisplay(snapshot.date)}</span>
                      <span style={{ fontSize: 13, color: '#ffffff', fontWeight: 600 }}>
                        {formatCurrency(snapshot.value, account.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Balance Card */}
        <div style={{
          background: `linear-gradient(135deg, #18181b 0%, #27272a 100%)`,
          borderRadius: 20, padding: '20px',
          border: `1px solid ${accentColor}40`,
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 4 }}>Balance Actual</div>
          <div style={{
            fontSize: 32, fontWeight: 700, letterSpacing: '-0.5px',
            color: balance >= 0 ? '#4ade80' : '#f87171',
          }}>
            {formatCurrency(balance, account.currency)}
          </div>
        </div>

        {/* Balance History Chart */}
        {balanceHistory.length >= 2 && (
          <div style={{
            backgroundColor: '#1a1a1a',
            borderRadius: 16,
            padding: '16px 8px 8px 0',
            border: '1px solid #2a2a2a',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e5e5', marginBottom: 12, paddingLeft: 16 }}>
              Balance en el Tiempo
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={balanceHistory} margin={{ top: 5, right: 16, left: 8, bottom: 5 }}>
                <XAxis
                  dataKey="date"
                  tickFormatter={formatChartDate}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={{ stroke: '#27272a' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickFormatter={(v: number) => formatCurrency(v, account.currency)}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  width={72}
                />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={0} stroke="#27272a" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="balance"
                  stroke={accentColor}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: accentColor, stroke: '#0a0a0a', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Movements List */}
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#e5e5e5', margin: '0 0 10px' }}>
            Movimientos ({totalCount})
          </h2>

          {movements.length === 0 ? (
            <div style={{
              backgroundColor: '#1a1a1a', borderRadius: 16,
              padding: '40px 20px', textAlign: 'center', color: '#a1a1aa',
              border: '1px solid #2a2a2a',
            }}>
              <span style={{ fontSize: 40, display: 'block', marginBottom: 8 }}>📊</span>
              <span style={{ fontSize: 14 }}>Sin movimientos en esta cuenta</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {movements.map((m) => (
                <div
                  key={m.id}
                  onClick={() => router.push(`/edit/${m.id}`)}
                  style={{
                    backgroundColor: m.receivable && !m.received ? '#2a2000' : '#1a1a1a',
                    borderRadius: 12,
                    padding: '12px 14px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    border: m.receivable && !m.received ? '1px solid #854d0e' : '1px solid #2a2a2a',
                    opacity: m.received ? 0.5 : 1,
                    textDecoration: m.received ? 'line-through' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      backgroundColor: m.categoryEmoji ? '#27272a' : (m.type === 'income' ? '#052e16' : '#450a0a'),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 16, flexShrink: 0,
                    }}>
                      {m.categoryEmoji || (m.type === 'income' ? '↑' : '↓')}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: 15, fontWeight: 500, color: '#e5e5e5',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {m.name}
                      </div>
                      {m.originalName && m.originalName !== m.name && (
                        <div style={{ fontSize: 11, color: '#71717a', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {m.originalName}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 1 }}>
                        {formatDateDisplay(m.date)}{m.time && ` · ${m.time}`}
                        {m.categoryName && <span> · {m.categoryName}</span>}
                      </div>
                    </div>
                  </div>
                  <span style={{
                    fontSize: 15, fontWeight: 600,
                    color: m.type === 'income' ? '#4ade80' : '#f87171',
                    whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 8,
                  }}>
                    {m.type === 'income' ? '+' : '-'}{formatCurrency(m.currency === 'USD' && m.amountUsd ? m.amountUsd : m.amount, m.currency)}
                  </span>
                </div>
              ))}
              {hasMore && (
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  style={{
                    padding: '12px', borderRadius: 12, border: '1px solid #2a2a2a',
                    backgroundColor: '#1a1a1a', color: '#a1a1aa', fontSize: 14,
                    fontWeight: 600, cursor: loadingMore ? 'not-allowed' : 'pointer',
                    marginTop: 4, opacity: loadingMore ? 0.5 : 1,
                  }}
                >
                  {loadingMore ? 'Cargando...' : `Ver más (${totalCount - movements.length} restantes)`}
                </button>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
