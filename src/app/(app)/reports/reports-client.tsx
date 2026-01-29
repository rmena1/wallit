'use client'

import { formatMoney } from '@/lib/utils'

interface CategorySpending {
  name: string
  emoji: string
  total: number
  count: number
}

interface ReportsPageProps {
  monthLabel: string
  totalIncome: number
  totalExpense: number
  movementCount: number
  categorySpending: CategorySpending[]
}

export function ReportsPage({ monthLabel, totalIncome, totalExpense, movementCount, categorySpending }: ReportsPageProps) {
  const netBalance = totalIncome - totalExpense
  const maxCategoryTotal = Math.max(...categorySpending.map(c => c.total), 1)

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
        <div style={{ maxWidth: 540, margin: '0 auto', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#f5f5f5' }}>Reportes</span>
        </div>
      </header>

      <main style={{ maxWidth: 540, margin: '0 auto', padding: '16px 16px 96px' }}>
        {/* Month Label */}
        <div style={{
          textAlign: 'center', marginBottom: 16,
          fontSize: 14, color: '#71717a', textTransform: 'capitalize',
        }}>
          📅 {monthLabel}
        </div>

        {/* Summary Cards */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <div style={{
            flex: 1, backgroundColor: '#1a1a1a', borderRadius: 14,
            padding: '14px 12px', border: '1px solid #2a2a2a',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, color: '#71717a', marginBottom: 4 }}>Ingresos</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#4ade80' }}>{formatMoney(totalIncome)}</div>
          </div>
          <div style={{
            flex: 1, backgroundColor: '#1a1a1a', borderRadius: 14,
            padding: '14px 12px', border: '1px solid #2a2a2a',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, color: '#71717a', marginBottom: 4 }}>Gastos</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#f87171' }}>{formatMoney(totalExpense)}</div>
          </div>
          <div style={{
            flex: 1, backgroundColor: '#1a1a1a', borderRadius: 14,
            padding: '14px 12px', border: '1px solid #2a2a2a',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, color: '#71717a', marginBottom: 4 }}>Neto</div>
            <div style={{
              fontSize: 18, fontWeight: 700,
              color: netBalance >= 0 ? '#4ade80' : '#f87171',
            }}>
              {formatMoney(Math.abs(netBalance))}
            </div>
          </div>
        </div>

        {/* Movement Count */}
        <div style={{
          backgroundColor: '#1a1a1a', borderRadius: 14,
          padding: '14px 16px', border: '1px solid #2a2a2a',
          marginBottom: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 14, color: '#a1a1aa' }}>Total movimientos</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#e5e5e5' }}>{movementCount}</span>
        </div>

        {/* Spending by Category */}
        <div style={{
          backgroundColor: '#1a1a1a', borderRadius: 16,
          padding: 16, border: '1px solid #2a2a2a',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#e5e5e5', margin: '0 0 14px' }}>
            Gastos por Categoría
          </h2>

          {categorySpending.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#52525b', padding: '20px 0', fontSize: 13 }}>
              Sin gastos este mes
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {categorySpending.map((cat, i) => (
                <div key={i}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 16 }}>{cat.emoji}</span>
                      <span style={{ fontSize: 14, color: '#d4d4d8' }}>{cat.name}</span>
                      <span style={{ fontSize: 11, color: '#52525b' }}>({cat.count})</span>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#f87171' }}>
                      {formatMoney(cat.total)}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div style={{
                    height: 6, borderRadius: 3, backgroundColor: '#27272a',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%', borderRadius: 3,
                      backgroundColor: '#ef4444',
                      width: `${(cat.total / maxCategoryTotal) * 100}%`,
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
