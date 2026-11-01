/** SQL aggregates in canonical CLP cents, already scoped and reportable-filtered. */
export interface ReportAggregate {
  categoryId: string | null
  date?: string
  income: number | string
  expense: number | string
  count?: number | string
  incomeCount?: number | string
  expenseCount?: number | string
}

/** One reporting rule for totals, breakdowns and cumulative charts.
 * dailyData contains changes in cumulative nets (refunds can make these negative),
 * not independently netted daily totals. Uncategorized amounts remain gross.
 */
export function netReportCategories(rows: readonly ReportAggregate[]) {
  const categories = new Map<string | null, { categoryId: string | null; income: number; expense: number; count: number; incomeCount: number; expenseCount: number }>()
  const dailyData: { date: string; income: number; expense: number }[] = []
  let totalIncome = 0, totalExpense = 0, grossIncome = 0, grossExpense = 0, count = 0
  for (const row of [...rows].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))) {
    const income = Number(row.income), expense = Number(row.expense)
    const category = categories.get(row.categoryId) ?? { categoryId: row.categoryId, income: 0, expense: 0, count: 0, incomeCount: 0, expenseCount: 0 }
    const before = category.income - category.expense
    category.income += income
    category.expense += expense
    category.count += Number(row.count ?? 0)
    category.incomeCount += Number(row.incomeCount ?? (income ? row.count ?? 0 : 0))
    category.expenseCount += Number(row.expenseCount ?? (expense ? row.count ?? 0 : 0))
    categories.set(row.categoryId, category)
    const after = category.income - category.expense
    const incomeChange = row.categoryId === null ? income : Math.max(after, 0) - Math.max(before, 0)
    const expenseChange = row.categoryId === null ? expense : Math.max(-after, 0) - Math.max(-before, 0)
    totalIncome += incomeChange
    totalExpense += expenseChange
    grossIncome += income
    grossExpense += expense
    count += Number(row.count ?? 0)
    if (row.date) {
      let day = dailyData.at(-1)
      if (day?.date !== row.date) {
        day = { date: row.date, income: 0, expense: 0 }
        dailyData.push(day)
      }
      day.income += incomeChange
      day.expense += expenseChange
    }
  }
  const breakdown = [...categories.values()].flatMap(category => {
    const net = category.income - category.expense
    const base = { categoryId: category.categoryId, count: category.count, grossIncome: category.income, grossExpense: category.expense }
    if (category.categoryId === null) {
      return [
        ...(category.income ? [{ ...base, count: category.incomeCount, type: 'income' as const, total: category.income, net: category.income }] : []),
        ...(category.expense ? [{ ...base, count: category.expenseCount, type: 'expense' as const, total: category.expense, net: -category.expense }] : []),
      ]
    }
    return net === 0 ? [] : [{ ...base, type: net > 0 ? 'income' as const : 'expense' as const, total: Math.abs(net), net }]
  }).sort((a, b) => b.total - a.total)
  return { totalIncome, totalExpense, grossIncome, grossExpense, count, dailyData, breakdown }
}
