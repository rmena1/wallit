'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { logout } from '@/lib/actions/auth'
import { deleteMovement } from '@/lib/actions/movements'
import { markAsReceived, markAsReceivedWithExisting } from '@/lib/actions/review'
import { formatDateDisplay, formatCurrency } from '@/lib/utils'
import type { AccountWithBalance } from '@/lib/actions/balances'

interface MovementWithCategory {
  id: string
  userId: string
  categoryId: string | null
  accountId: string | null
  name: string
  date: string
  amount: number
  type: 'income' | 'expense'
  createdAt: Date
  updatedAt: Date
  categoryName: string | null
  categoryEmoji: string | null
  accountBankName: string | null
  accountLastFour: string | null
  accountColor: string | null
  accountEmoji: string | null
  currency: 'CLP' | 'USD'
  receivable: boolean
  received: boolean
  receivableId: string | null
}

interface UserAccount {
  id: string
  bankName: string
  lastFourDigits: string
  emoji: string | null
}

interface UnlinkedIncome {
  id: string
  name: string
  date: string
  amount: number
  currency: 'CLP' | 'USD'
  accountBankName: string | null
  accountLastFour: string | null
  accountEmoji: string | null
  categoryName: string | null
  categoryEmoji: string | null
}

interface HomePageProps {
  email: string
  accountBalances: AccountWithBalance[]
  totalBalance: number
  totalIncome: number
  totalExpense: number
  movements: MovementWithCategory[]
  pendingReviewCount: number
  usdClpRate: number | null
  userAccounts: UserAccount[]
  recentUnlinkedIncomes: UnlinkedIncome[]
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function getAccountIconFromType(accountType: string): string {
  switch (accountType) {
    case 'Crédito': return '💳'
    case 'Corriente': return '🏦'
    case 'Vista': return '👁️'
    case 'Ahorro': return '🐷'
    case 'Prepago': return '💵'
    default: return '🏦'
  }
}

export function HomePage({ email, accountBalances, totalBalance, totalIncome, totalExpense, movements, pendingReviewCount, usdClpRate, userAccounts, recentUnlinkedIncomes }: HomePageProps) {
  const router = useRouter()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [receivableFilter, setReceivableFilter] = useState(false)
  const [markingReceived, setMarkingReceived] = useState<string | null>(null)
  const [paymentDialogId, setPaymentDialogId] = useState<string | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('cash')
  const [paymentMode, setPaymentMode] = useState<'new' | 'existing'>('new')
  const [selectedExistingIncomeId, setSelectedExistingIncomeId] = useState<string | null>(null)
  const reviewCount = pendingReviewCount

  function openPaymentDialog(id: string) {
    setSelectedAccountId('cash')
    setPaymentMode('new')
    setSelectedExistingIncomeId(null)
    setPaymentDialogId(id)
  }

  async function handleConfirmPayment() {
    if (!paymentDialogId) return
    const id = paymentDialogId
    setPaymentDialogId(null)
    setMarkingReceived(id)
    try {
      if (paymentMode === 'existing' && selectedExistingIncomeId) {
        await markAsReceivedWithExisting(id, selectedExistingIncomeId)
      } else {
        const accountId = selectedAccountId === 'cash' ? undefined : selectedAccountId
        await markAsReceived(id, accountId)
      }
    } finally {
      setMarkingReceived(null)
    }
  }

  const canConfirmPayment = paymentMode === 'new' || (paymentMode === 'existing' && selectedExistingIncomeId !== null)

  const filteredMovements = receivableFilter
    ? movements.filter(m => m.receivable && !m.received)
    : movements

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este movimiento?')) return
    setDeletingId(id)
    try {
      await deleteMovement(id)
    } finally {
      setDeletingId(null)
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}>
              💰
            </div>
            <span style={{ fontSize: 17, fontWeight: 700, color: '#f5f5f5' }}>wallit</span>
            {usdClpRate !== null && (
              <span style={{ fontSize: 12, color: '#22c55e', backgroundColor: '#1a2e1a', padding: '2px 8px', borderRadius: 6, fontWeight: 600, marginLeft: 4 }}>
                USD {formatCurrency(usdClpRate, 'CLP')}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#71717a', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
            <button
              onClick={() => logout()}
              style={{
                padding: '6px 12px', borderRadius: 8,
                border: '1px solid #2a2a2a', backgroundColor: '#1a1a1a',
                fontSize: 13, fontWeight: 500, color: '#a1a1aa', cursor: 'pointer',
              }}
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main style={{ maxWidth: 540, margin: '0 auto', padding: '16px 16px 96px' }}>
        {/* Total Balance Card — only show when user has accounts */}
        {accountBalances.length > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)',
          borderRadius: 20, padding: '20px 20px 16px', marginBottom: 16,
          color: '#fff',
          border: '1px solid #2a2a2a',
        }}>
          <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 4 }}>Balance General</div>
          <div style={{
            fontSize: 32, fontWeight: 700, letterSpacing: '-0.5px',
            color: totalBalance >= 0 ? '#4ade80' : '#f87171',
            whiteSpace: 'nowrap',
          }}>
            {formatCurrency(totalBalance, 'CLP')}
          </div>
          <div style={{
            display: 'flex', gap: 16, marginTop: 16, paddingTop: 16,
            borderTop: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 2 }}>Ingresos</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#4ade80', whiteSpace: 'nowrap' }}>
                {formatCurrency(totalIncome, 'CLP')}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 2 }}>Gastos</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#f87171', whiteSpace: 'nowrap' }}>
                {formatCurrency(totalExpense, 'CLP')}
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Account Cards */}
        {accountBalances.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: '#e5e5e5', margin: '0 0 10px' }}>
              Cuentas
            </h2>
            <div style={{
              display: 'flex',
              gap: 10,
              overflowX: 'auto',
              paddingBottom: 4,
              scrollbarWidth: 'none',
            }}>
              {accountBalances.map((acc) => (
                <div key={acc.id} style={{
                  minWidth: 160,
                  backgroundColor: '#1a1a1a',
                  borderRadius: 14,
                  padding: '14px 14px 12px',
                  border: `1px solid ${acc.color ? acc.color + '40' : '#2a2a2a'}`,
                  flexShrink: 0,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: 16 }}>{acc.emoji || getAccountIconFromType(acc.accountType)}</span>
                    <span style={{ fontSize: 12, color: acc.color || '#a1a1aa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {acc.bankName}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 18, fontWeight: 700,
                    color: acc.balance >= 0 ? '#e5e5e5' : '#f87171',
                    whiteSpace: 'nowrap',
                    marginBottom: 4,
                  }}>
                    {formatCurrency(acc.balance, acc.currency)}
                  </div>
                  <div style={{ fontSize: 11, color: '#52525b' }}>
                    {acc.accountType} · ···{acc.lastFourDigits}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No accounts — welcoming onboarding empty state */}
        {accountBalances.length === 0 && (
          <div style={{
            background: 'linear-gradient(135deg, #18181b 0%, #1a2e1a 100%)',
            borderRadius: 20,
            padding: '48px 24px', textAlign: 'center',
            border: '1px solid #2a3a2a', marginBottom: 20,
          }}>
            <span style={{ fontSize: 56, display: 'block', marginBottom: 16 }}>💰</span>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#f5f5f5', marginBottom: 8 }}>
              ¡Bienvenido a Wallit!
            </div>
            <div style={{ fontSize: 15, color: '#a1a1aa', marginBottom: 28, lineHeight: 1.5 }}>
              Agrega tu primera cuenta bancaria para empezar a rastrear ingresos, gastos y tu balance en tiempo real.
            </div>
            <a
              href="/settings"
              style={{
                display: 'block',
                padding: '14px 24px', borderRadius: 14, border: 'none',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(34,197,94,0.3)',
                textDecoration: 'none',
              }}
            >
              Agregar Cuenta →
            </a>
          </div>
        )}

        {/* Review Banner */}
        {reviewCount > 0 && (
          <a href="/review" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: '#1a1a0a', borderRadius: 14, padding: '14px 16px',
            border: '1px solid #854d0e', marginBottom: 16,
            textDecoration: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #1a1a0a, #27200a)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>👀</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#fbbf24' }}>
                  {reviewCount} movimiento{reviewCount !== 1 ? 's' : ''} pendiente{reviewCount !== 1 ? 's' : ''} de revisión
                </div>
                <div style={{ fontSize: 12, color: '#a18329', marginTop: 2 }}>
                  Toca para revisar
                </div>
              </div>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </a>
        )}

        {/* Recent Movements — only show when user has accounts */}
        {accountBalances.length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: '#e5e5e5', margin: 0 }}>
              Movimientos Recientes
            </h2>
            <button
              onClick={() => setReceivableFilter(f => !f)}
              style={{
                padding: '4px 12px', borderRadius: 8, border: 'none',
                backgroundColor: receivableFilter ? '#92400e' : '#27272a',
                color: receivableFilter ? '#fbbf24' : '#71717a',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              💰 Por cobrar
            </button>
          </div>

          {filteredMovements.length === 0 ? (
            <div style={{
              backgroundColor: '#1a1a1a', borderRadius: 16,
              padding: '40px 20px', textAlign: 'center', color: '#71717a',
              border: '1px solid #2a2a2a',
            }}>
              <span style={{ fontSize: 40, display: 'block', marginBottom: 8 }}>📊</span>
              <span style={{ fontSize: 14 }}>Sin movimientos aún</span>
              <a
                href="/add"
                style={{
                  display: 'inline-block', marginTop: 12,
                  padding: '8px 20px', borderRadius: 10, border: 'none',
                  background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                  color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  textDecoration: 'none',
                }}
              >
                Agregar Movimiento
              </a>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredMovements.map((m) => (
                <div
                  key={m.id}
                  onClick={() => router.push(`/edit/${m.id}`)}
                  style={{
                    backgroundColor: m.receivable && !m.received ? '#2a2000' : m.received ? '#1a1a1a' : '#1a1a1a',
                    borderRadius: 12,
                    padding: '12px 14px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    border: m.receivable && !m.received ? '1px solid #854d0e' : '1px solid #2a2a2a',
                    opacity: deletingId === m.id || markingReceived === m.id ? 0.4 : m.received ? 0.5 : 1,
                    transition: 'opacity 0.2s ease',
                    textDecoration: m.received ? 'line-through' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                    {m.receivable && !m.received && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openPaymentDialog(m.id) }}
                        disabled={markingReceived === m.id}
                        style={{
                          width: 24, height: 24, borderRadius: 6,
                          border: '2px solid #fbbf24', backgroundColor: 'transparent',
                          cursor: 'pointer', flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                        title="Marcar como cobrado"
                      />
                    )}
                    {m.received && (
                      <div style={{
                        width: 24, height: 24, borderRadius: 6,
                        border: '2px solid #4ade80', backgroundColor: '#052e16',
                        flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, color: '#4ade80',
                      }}>✓</div>
                    )}
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
                      <div style={{ fontSize: 12, color: '#52525b', marginTop: 1 }}>
                        {formatDateDisplay(m.date)}
                        {m.categoryName && (
                          <span> · {m.categoryName}</span>
                        )}
                        {m.accountBankName && (
                          <span style={{ color: m.accountColor || undefined }}> · {m.accountEmoji || ''} {m.accountBankName} ···{m.accountLastFour}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 8 }}>
                    <span style={{
                      fontSize: 15, fontWeight: 600,
                      color: m.type === 'income' ? '#4ade80' : '#f87171',
                      whiteSpace: 'nowrap',
                    }}>
                      {m.type === 'income' ? '+' : '-'}{formatCurrency(m.amount, 'CLP')}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(m.id) }}
                      disabled={deletingId === m.id}
                      style={{
                        width: 30, height: 30, borderRadius: 8,
                        border: 'none', backgroundColor: 'transparent',
                        cursor: 'pointer', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        color: '#3f3f46',
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </main>

      {/* Payment Dialog */}
      {paymentDialogId && (
        <div
          onClick={() => setPaymentDialogId(null)}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 100, padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              backgroundColor: '#1a1a1a', borderRadius: 20, padding: 24,
              border: '1px solid #2a2a2a', width: '100%', maxWidth: 380,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: '#e5e5e5', marginBottom: 4 }}>
              💰 Cobrar gasto
            </div>
            <div style={{ fontSize: 13, color: '#71717a', marginBottom: 16 }}>
              ¿Cómo registrar el cobro?
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid #2a2a2a' }}>
              <button
                onClick={() => setPaymentMode('new')}
                style={{
                  flex: 1, padding: '10px 8px', border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                  backgroundColor: paymentMode === 'new' ? '#27272a' : '#111',
                  color: paymentMode === 'new' ? '#4ade80' : '#71717a',
                  borderBottom: paymentMode === 'new' ? '2px solid #4ade80' : '2px solid transparent',
                  transition: 'all 0.15s ease',
                }}
              >
                Nuevo ingreso
              </button>
              <button
                onClick={() => setPaymentMode('existing')}
                style={{
                  flex: 1, padding: '10px 8px', border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                  backgroundColor: paymentMode === 'existing' ? '#27272a' : '#111',
                  color: paymentMode === 'existing' ? '#4ade80' : '#71717a',
                  borderBottom: paymentMode === 'existing' ? '2px solid #4ade80' : '2px solid transparent',
                  transition: 'all 0.15s ease',
                }}
              >
                Vincular existente
              </button>
            </div>

            {paymentMode === 'new' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {/* Cash option */}
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                  backgroundColor: selectedAccountId === 'cash' ? '#27272a' : 'transparent',
                  border: selectedAccountId === 'cash' ? '1px solid #4ade80' : '1px solid #2a2a2a',
                  transition: 'all 0.15s ease',
                }}
              >
                <input
                  type="radio" name="paymentAccount" value="cash"
                  checked={selectedAccountId === 'cash'}
                  onChange={() => setSelectedAccountId('cash')}
                  style={{ display: 'none' }}
                />
                <span style={{ fontSize: 20 }}>💵</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e5e5' }}>Efectivo</div>
                  <div style={{ fontSize: 11, color: '#71717a' }}>No genera movimiento de ingreso</div>
                </div>
                {selectedAccountId === 'cash' && (
                  <span style={{ marginLeft: 'auto', color: '#4ade80', fontSize: 16 }}>✓</span>
                )}
              </label>

              {/* Account options */}
              {userAccounts.map(acc => (
                <label
                  key={acc.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                    backgroundColor: selectedAccountId === acc.id ? '#27272a' : 'transparent',
                    border: selectedAccountId === acc.id ? '1px solid #4ade80' : '1px solid #2a2a2a',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <input
                    type="radio" name="paymentAccount" value={acc.id}
                    checked={selectedAccountId === acc.id}
                    onChange={() => setSelectedAccountId(acc.id)}
                    style={{ display: 'none' }}
                  />
                  <span style={{ fontSize: 20 }}>{acc.emoji || '🏦'}</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e5e5' }}>{acc.bankName}</div>
                    <div style={{ fontSize: 11, color: '#71717a' }}>···{acc.lastFourDigits}</div>
                  </div>
                  {selectedAccountId === acc.id && (
                    <span style={{ marginLeft: 'auto', color: '#4ade80', fontSize: 16 }}>✓</span>
                  )}
                </label>
              ))}
            </div>
            ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24, maxHeight: 280, overflowY: 'auto' }}>
              {recentUnlinkedIncomes.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: '#71717a', fontSize: 13 }}>
                  No hay ingresos recientes sin vincular
                </div>
              ) : (
                recentUnlinkedIncomes.map(inc => (
                  <label
                    key={inc.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                      backgroundColor: selectedExistingIncomeId === inc.id ? '#27272a' : 'transparent',
                      border: selectedExistingIncomeId === inc.id ? '1px solid #4ade80' : '1px solid #2a2a2a',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="radio" name="existingIncome" value={inc.id}
                      checked={selectedExistingIncomeId === inc.id}
                      onChange={() => setSelectedExistingIncomeId(inc.id)}
                      style={{ display: 'none' }}
                    />
                    <span style={{ fontSize: 16 }}>{inc.categoryEmoji || '↑'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e5e5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {inc.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#71717a' }}>
                        {formatDateDisplay(inc.date)}
                        {inc.accountBankName && <span> · {inc.accountEmoji || ''} {inc.accountBankName}</span>}
                      </div>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#4ade80', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      +{formatCurrency(inc.amount, 'CLP')}
                    </span>
                    {selectedExistingIncomeId === inc.id && (
                      <span style={{ color: '#4ade80', fontSize: 16, flexShrink: 0 }}>✓</span>
                    )}
                  </label>
                ))
              )}
            </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setPaymentDialogId(null)}
                style={{
                  flex: 1, padding: '12px', borderRadius: 12,
                  border: '1px solid #2a2a2a', backgroundColor: '#111',
                  color: '#a1a1aa', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmPayment}
                disabled={!canConfirmPayment}
                style={{
                  flex: 1, padding: '12px', borderRadius: 12,
                  border: 'none',
                  background: canConfirmPayment ? 'linear-gradient(135deg, #22c55e, #16a34a)' : '#27272a',
                  color: canConfirmPayment ? '#fff' : '#52525b',
                  fontSize: 14, fontWeight: 600,
                  cursor: canConfirmPayment ? 'pointer' : 'not-allowed',
                  boxShadow: canConfirmPayment ? '0 2px 8px rgba(34,197,94,0.25)' : 'none',
                }}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
