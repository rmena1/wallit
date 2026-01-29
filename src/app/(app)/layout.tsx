import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { BottomNav } from '@/components/bottom-nav'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div style={{ minHeight: '100dvh', backgroundColor: '#0a0a0a' }}>
      {children}
      <BottomNav />
    </div>
  )
}
