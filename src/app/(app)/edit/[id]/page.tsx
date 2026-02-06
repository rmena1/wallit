import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { getMovementById } from '@/lib/actions/movements'
import { getTransferByMovementId } from '@/lib/actions/transfers'
import { getAccountsAndCategories } from '@/lib/actions/review'
import { EditClient } from './edit-client'
import { EditTransferClient } from './edit-transfer-client'

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id } = await params
  const [movement, { accounts, categories }] = await Promise.all([
    getMovementById(id),
    getAccountsAndCategories(),
  ])

  if (!movement) notFound()

  // Check if this is a transfer
  if (movement.transferId) {
    const transfer = await getTransferByMovementId(id)
    if (transfer) {
      return (
        <EditTransferClient
          transfer={transfer}
          accounts={accounts}
        />
      )
    }
  }

  return (
    <EditClient
      movement={movement}
      accounts={accounts}
      categories={categories}
    />
  )
}
