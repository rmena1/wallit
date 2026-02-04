import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getReportData } from '@/lib/actions/reports'
import dynamic from 'next/dynamic'

const ReportsPage = dynamic(() => import('./reports-client').then(m => m.ReportsPage), {
  loading: () => <ReportsSkeleton />,
})

function ReportsSkeleton() {
  const shimmer: React.CSSProperties = {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    border: '1px solid #2a2a2a',
    animation: 'pulse 1.5s ease-in-out infinite',
  }
  return (
    <>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }`}</style>
      <header style={{
        backgroundColor: '#111111', borderBottom: '1px solid #1e1e1e',
        padding: '12px 16px', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: 540, margin: '0 auto', display: 'flex', justifyContent: 'center' }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#f5f5f5' }}>Reportes</span>
        </div>
      </header>
      <main style={{ maxWidth: 540, margin: '0 auto', padding: '16px 16px 96px' }}>
        <div style={{ ...shimmer, height: 42, marginBottom: 12 }} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <div style={{ ...shimmer, flex: 1, height: 70 }} />
          <div style={{ ...shimmer, flex: 1, height: 70 }} />
          <div style={{ ...shimmer, flex: 1, height: 70 }} />
        </div>
        <div style={{ ...shimmer, height: 240, marginBottom: 16, padding: 16 }} />
        <div style={{ ...shimmer, height: 240, marginBottom: 16, padding: 16 }} />
      </main>
    </>
  )
}

function getDefaultRange(): [string, string] {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0) // last day of month
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return [fmt(start), fmt(end)]
}

export default async function Reports() {
  const session = await getSession()
  if (!session) redirect('/login')

  const [startDate, endDate] = getDefaultRange()
  const initialData = await getReportData(startDate, endDate)

  return (
    <ReportsPage
      initialData={initialData}
      initialStartDate={startDate}
      initialEndDate={endDate}
    />
  )
}
