import { getCurrentSpace } from '@/lib/spaces'
import { getPendingReviewMovements, getAccountsAndCategories } from '@/lib/actions/review'
import { db, accounts as accountsTable, categories as categoriesTable, ownBankTransferImports } from '@/lib/db'
import { and, desc, eq, sql } from 'drizzle-orm'
import { formatCurrency } from '@/lib/utils'
import { ReviewClient } from './review-client'

export default async function ReviewPage() {
  const { user, space, spaces } = await getCurrentSpace()

  const [pendingMovements, { accounts, categories }, transferAccounts, transferCategories, pendingBankTransfers] = await Promise.all([
    getPendingReviewMovements(),
    getAccountsAndCategories(),
    db.select().from(accountsTable).where(sql`${accountsTable.spaceId} IN (${sql.join(spaces.map((s) => sql`${s.id}`), sql`, `)})`).orderBy(accountsTable.bankName),
    db.select().from(categoriesTable).where(sql`${categoriesTable.spaceId} IN (${sql.join(spaces.map((s) => sql`${s.id}`), sql`, `)})`).orderBy(categoriesTable.name),
    db.select().from(ownBankTransferImports).where(and(
      eq(ownBankTransferImports.createdByUserId, user.id), eq(ownBankTransferImports.status, 'pending_accounts'),
    )).orderBy(desc(ownBankTransferImports.date)),
  ])

  return (
    <>
      {pendingBankTransfers.length > 0 && (
        <section aria-labelledby="pending-bank-transfers" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-slate-900">
          <h2 id="pending-bank-transfers" className="font-semibold">Transferencias propias con cuentas por vincular</h2>
          <p className="mt-1 text-sm">Están guardadas como transferencias. Falta identificar sus cuentas en Wallit para reflejarlas en los saldos.</p>
          <ul className="mt-3 space-y-3">
            {pendingBankTransfers.map(transfer => (
              <li key={transfer.id} className="text-sm">
                <div className="font-medium">{bankLabel(transfer.fromBank)} {transfer.fromNumber ? `••••${transfer.fromNumber.slice(-4)}` : '(número no informado)'} → {bankLabel(transfer.toBank)} {transfer.toNumber ? `••••${transfer.toNumber.slice(-4)}` : '(número no informado)'}</div>
                <div>{transfer.date} · {formatCurrency(transfer.amount, 'CLP')}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ReviewClient
        movements={pendingMovements}
        accounts={accounts}
        transferAccounts={transferAccounts}
        transferSpaces={spaces.map((s) => ({ id: s.id, name: s.name, emoji: s.emoji, isCurrent: s.id === space.id, hasAccounts: transferAccounts.some((a) => a.spaceId === s.id) }))}
        currentSpaceId={space.id}
        categories={categories}
        transferCategories={transferCategories}
      />
    </>
  )
}

function bankLabel(bank: string) {
  return ({ bci: 'BCI', tenpo: 'Tenpo', mercadopago: 'Mercado Pago', mach: 'MACHBANK' } as Record<string, string>)[bank] || bank
}
