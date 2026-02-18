'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { settleLoan, type LoanPaybackExpense } from '@/lib/actions/loans'
import { formatCurrency, formatDateDisplay, today } from '@/lib/utils'

interface LoanData {
  id: string
  name: string
  amount: number
  date: string
  currency: 'CLP' | 'USD'
  accountId: string | null
  accountBankName: string | null
  accountEmoji: string | null
  loanSettled: boolean
  totalPaid: number
  remaining: number
  expenses: LoanPaybackExpense[]
}

interface CandidateExpense {
  id: string
  name: string
  amount: number
  date: string
  currency: 'CLP' | 'USD'
  accountBankName: string | null
  accountLastFour: string | null
  accountEmoji: string | null
}

interface Props {
  loan: LoanData
  candidateExpenses: CandidateExpense[]
}

export function LoanDetailClient({ loan, candidateExpenses }: Props) {
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [settleMode, setSettleMode] = useState<'cash' | 'expense'>('cash')
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(candidateExpenses[0]?.id ?? null)
  const [settleDate, setSettleDate] = useState(today())

  const progress = loan.amount > 0 ? Math.min(100, (loan.totalPaid / loan.amount) * 100) : 0

  async function handleSettle() {
    setLoading(true)
    setError(null)

    try {
      if (settleMode === 'expense' && !selectedExpenseId) {
        setError('Selecciona un gasto para vincular')
        setLoading(false)
        return
      }

      const expenseMovementId = settleMode === 'cash' ? 'cash' : selectedExpenseId!
      const result = await settleLoan(loan.id, expenseMovementId, settleDate)

      if (!result.success) {
        setError(result.error || 'Error al saldar préstamo')
        setLoading(false)
        return
      }

      setShowModal(false)
      router.refresh()
    } catch {
      setError('Error al registrar el pago del préstamo')
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
          <button onClick={() => router.push('/loans')} style={{
            background: 'none', border: 'none', color: '#a1a1aa',
            fontSize: 15, cursor: 'pointer', padding: '4px 0',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Volver
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#f5f5f5' }}>💵 Préstamo</span>
          <div style={{ width: 60 }} />
        </div>
      </header>

      <main style={{ maxWidth: 540, margin: '0 auto', padding: '16px 16px 96px' }}>
        <div style={{
          backgroundColor: '#1a1a1a', borderRadius: 16, padding: 20,
          border: '1px solid #8b5cf640', marginBottom: 16,
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#e5e5e5', marginBottom: 4 }}>
            {loan.name}
          </div>
          <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 12 }}>
            {formatDateDisplay(loan.date)}
            {loan.accountBankName && <span> · {loan.accountEmoji || '🏦'} {loan.accountBankName}</span>}
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 2 }}>Total</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#c4b5fd' }}>
                {formatCurrency(loan.amount, loan.currency)}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 2 }}>Pagado</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#4ade80' }}>
                {formatCurrency(loan.totalPaid, loan.currency)}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 2 }}>Restante</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#fbbf24' }}>
                {formatCurrency(loan.remaining, loan.currency)}
              </div>
            </div>
          </div>

          <div style={{ height: 8, borderRadius: 4, backgroundColor: '#27272a', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4,
              backgroundColor: progress >= 100 ? '#4ade80' : '#8b5cf6',
              width: `${progress}%`,
              transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 4, textAlign: 'right' }}>
            {progress.toFixed(0)}% saldado
          </div>

          {!loan.loanSettled && (
            <button onClick={() => {
              setShowModal(true)
              setSettleMode('cash')
              setSettleDate(today())
              setSelectedExpenseId(candidateExpenses[0]?.id ?? null)
              setError(null)
            }} style={{
              width: '100%', height: 48, borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
              color: '#fff', fontSize: 15, fontWeight: 600,
              cursor: 'pointer', marginTop: 16,
              boxShadow: '0 4px 12px rgba(139,92,246,0.3)',
            }}>
              💸 Saldar préstamo
            </button>
          )}

          {loan.loanSettled && (
            <div style={{
              padding: '12px 16px', borderRadius: 12,
              backgroundColor: '#052e16', border: '1px solid #16a34a',
              color: '#4ade80', fontSize: 14, fontWeight: 600,
              textAlign: 'center', marginTop: 16,
            }}>
              ✅ Préstamo completamente saldado
            </div>
          )}
        </div>

        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#e5e5e5', margin: '0 0 10px' }}>
            Gastos vinculados ({loan.expenses.length})
          </h2>
          {loan.expenses.length === 0 ? (
            <div style={{
              backgroundColor: '#1a1a1a', borderRadius: 12, padding: '24px 16px',
              textAlign: 'center', color: '#a1a1aa', fontSize: 13,
              border: '1px solid #2a2a2a',
            }}>
              Sin gastos vinculados aún
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {loan.expenses.map((expense) => (
                <div key={expense.id} style={{
                  backgroundColor: '#1a1a1a', borderRadius: 12, padding: '12px 14px',
                  border: '1px solid #2a2a2a',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 14, color: '#e5e5e5' }}>
                      {expense.accountEmoji || '🏦'} {expense.accountBankName || 'Cuenta'}
                      <span style={{ color: '#a1a1aa' }}> · {expense.name}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 2 }}>
                      {formatDateDisplay(expense.date)}
                    </div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#f87171' }}>
                    {formatCurrency(expense.amount, loan.currency)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 50, padding: 16,
        }}>
          <div style={{
            backgroundColor: '#1a1a1a', borderRadius: 16, padding: 24,
            border: '1px solid #2a2a2a', maxWidth: 420, width: '100%',
            maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#c4b5fd', marginBottom: 16 }}>
              💸 Saldar préstamo
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

            <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderRadius: 10, overflow: 'hidden', border: '1px solid #2a2a2a' }}>
              <button
                onClick={() => setSettleMode('cash')}
                style={{
                  flex: 1, padding: '10px 8px', border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                  backgroundColor: settleMode === 'cash' ? '#27272a' : '#111',
                  color: settleMode === 'cash' ? '#c4b5fd' : '#a1a1aa',
                  borderBottom: settleMode === 'cash' ? '2px solid #8b5cf6' : '2px solid transparent',
                }}
              >
                Efectivo
              </button>
              <button
                onClick={() => setSettleMode('expense')}
                style={{
                  flex: 1, padding: '10px 8px', border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                  backgroundColor: settleMode === 'expense' ? '#27272a' : '#111',
                  color: settleMode === 'expense' ? '#c4b5fd' : '#a1a1aa',
                  borderBottom: settleMode === 'expense' ? '2px solid #8b5cf6' : '2px solid transparent',
                }}
              >
                Vincular gasto
              </button>
            </div>

            {settleMode === 'cash' ? (
              <div style={{
                borderRadius: 12, padding: '12px 14px',
                backgroundColor: '#1f1730', border: '1px solid #8b5cf640',
                fontSize: 13, color: '#c4b5fd', marginBottom: 12,
              }}>
                🏦💸 Marcar este préstamo como saldado en efectivo.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, maxHeight: 260, overflowY: 'auto' }}>
                {candidateExpenses.length === 0 ? (
                  <div style={{ padding: '16px 12px', textAlign: 'center', color: '#a1a1aa', fontSize: 13 }}>
                    No hay gastos disponibles para vincular
                  </div>
                ) : (
                  candidateExpenses.map((expense) => (
                    <label
                      key={expense.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                        backgroundColor: selectedExpenseId === expense.id ? '#27272a' : 'transparent',
                        border: selectedExpenseId === expense.id ? '1px solid #8b5cf6' : '1px solid #2a2a2a',
                      }}
                    >
                      <input
                        type="radio"
                        name="expenseLoan"
                        value={expense.id}
                        checked={selectedExpenseId === expense.id}
                        onChange={() => setSelectedExpenseId(expense.id)}
                        style={{ display: 'none' }}
                      />
                      <span style={{ fontSize: 18 }}>{expense.accountEmoji || '🏦'}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e5e5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {expense.name}
                        </div>
                        <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 2 }}>
                          {formatDateDisplay(expense.date)}
                          {expense.accountBankName && <span> · {expense.accountBankName} ···{expense.accountLastFour}</span>}
                        </div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#f87171' }}>
                        {formatCurrency(expense.amount, loan.currency)}
                      </div>
                    </label>
                  ))
                )}
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 6, display: 'block' }}>Fecha</label>
              <input
                type="date"
                value={settleDate}
                onChange={e => setSettleDate(e.target.value)}
                style={{
                  width: '100%', height: 48, borderRadius: 12,
                  border: '1px solid #2a2a2a', backgroundColor: '#1a1a1a',
                  fontSize: 15, color: '#e5e5e5', padding: '0 14px', outline: 'none',
                  boxSizing: 'border-box', colorScheme: 'dark',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setShowModal(false)} style={{
                flex: 1, height: 44, borderRadius: 12, border: '1px solid #2a2a2a',
                backgroundColor: '#27272a', color: '#a1a1aa',
                fontSize: 15, fontWeight: 600, cursor: 'pointer',
              }}>
                Cancelar
              </button>
              <button onClick={handleSettle} disabled={loading} style={{
                flex: 1, height: 44, borderRadius: 12, border: 'none',
                backgroundColor: loading ? '#27272a' : '#7c3aed',
                color: '#fff', fontSize: 15, fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}>
                {loading ? 'Procesando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
