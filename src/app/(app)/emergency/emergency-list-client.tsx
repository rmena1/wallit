'use client'

import { useRouter } from 'next/navigation'
import { formatCurrency, formatDateDisplay } from '@/lib/utils'
import type { UnsettledEmergency } from '@/lib/actions/emergency'

interface Props {
  emergencies: UnsettledEmergency[]
}

export function EmergencyListClient({ emergencies }: Props) {
  const router = useRouter()

  return (
    <>
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
          <span style={{ fontSize: 17, fontWeight: 700, color: '#f5f5f5' }}>🚨 Emergencias</span>
          <div style={{ width: 60 }} />
        </div>
      </header>

      <main style={{ maxWidth: 540, margin: '0 auto', padding: '16px 16px 96px' }}>
        {emergencies.length === 0 ? (
          <div style={{
            backgroundColor: '#1a1a1a', borderRadius: 16,
            padding: '40px 20px', textAlign: 'center', color: '#a1a1aa',
            border: '1px solid #2a2a2a',
          }}>
            <span style={{ fontSize: 40, display: 'block', marginBottom: 8 }}>✅</span>
            <span style={{ fontSize: 14 }}>No hay gastos de emergencia pendientes</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {emergencies.map(e => {
              const progress = e.amount > 0 ? Math.min(100, (e.totalPaid / e.amount) * 100) : 0
              return (
                <div
                  key={e.id}
                  onClick={() => router.push(`/emergency/${e.id}`)}
                  style={{
                    backgroundColor: '#1a1a1a', borderRadius: 14, padding: '16px',
                    border: '1px solid #dc262640', cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: '#e5e5e5' }}>{e.name}</div>
                      <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 2 }}>
                        {formatDateDisplay(e.date)}
                        {e.accountBankName && <span> · {e.accountEmoji || '🏦'} {e.accountBankName}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#f87171' }}>
                        {formatCurrency(e.amount, e.currency)}
                      </div>
                      <div style={{ fontSize: 12, color: '#4ade80', marginTop: 2 }}>
                        Pagado: {formatCurrency(e.totalPaid, e.currency)}
                      </div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{
                    height: 6, borderRadius: 3, backgroundColor: '#27272a',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%', borderRadius: 3,
                      backgroundColor: progress >= 100 ? '#4ade80' : '#f59e0b',
                      width: `${progress}%`,
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 4, textAlign: 'right' }}>
                    Restante: {formatCurrency(e.remaining, e.currency)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}
