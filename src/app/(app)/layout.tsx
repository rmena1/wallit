import { getSession } from '@/lib/auth'
import { getCurrentSpaceForUser } from '@/lib/spaces'
import { redirect } from 'next/navigation'
import { BottomNav } from '@/components/bottom-nav'
import { SpaceSelector } from '@/components/space-selector'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()

  if (!session) {
    redirect('/login')
  }

  const { space, spaces } = await getCurrentSpaceForUser(session.id)

  return (
    <div style={{ minHeight: '100dvh', backgroundColor: '#0a0a0a' }}>
      <SpaceSelector spaces={spaces} currentSpaceId={space.id} />
      {children}
      <BottomNav />
    </div>
  )
}
