import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db, movements, categories, accounts } from '@/lib/db'
import { eq, desc, sql } from 'drizzle-orm'
import { Dashboard } from './dashboard'

export default async function HomePage() {
  const session = await getSession()
  
  if (!session) {
    redirect('/login')
  }
  
  // Fetch movements with category and account info
  const userMovements = await db
    .select({
      id: movements.id,
      userId: movements.userId,
      categoryId: movements.categoryId,
      accountId: movements.accountId,
      name: movements.name,
      date: movements.date,
      amount: movements.amount,
      type: movements.type,
      createdAt: movements.createdAt,
      updatedAt: movements.updatedAt,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      accountBankName: accounts.bankName,
      accountLastFour: accounts.lastFourDigits,
    })
    .from(movements)
    .leftJoin(categories, eq(movements.categoryId, categories.id))
    .leftJoin(accounts, eq(movements.accountId, accounts.id))
    .where(eq(movements.userId, session.id))
    .orderBy(desc(movements.date), desc(movements.createdAt))
  
  // Fetch accounts
  const userAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, session.id))
    .orderBy(accounts.bankName)

  // Fetch categories
  const userCategories = await db
    .select()
    .from(categories)
    .where(eq(categories.userId, session.id))
    .orderBy(categories.name)
  
  // Calculate totals
  const totalsResult = await db
    .select({
      totalIncome: sql<number>`COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)`,
      totalExpense: sql<number>`COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)`,
    })
    .from(movements)
    .where(eq(movements.userId, session.id))
  
  const totals = totalsResult[0] || { totalIncome: 0, totalExpense: 0 }
  const balance = totals.totalIncome - totals.totalExpense
  
  return (
    <Dashboard 
      email={session.email}
      movements={userMovements}
      accounts={userAccounts}
      categories={userCategories}
      balance={balance}
      totalIncome={totals.totalIncome}
      totalExpense={totals.totalExpense}
    />
  )
}
