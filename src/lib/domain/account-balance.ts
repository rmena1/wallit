type BalanceAccount = {
  accountType: string
  initialBalance: number
  creditLimit: number | null
  isInvestment: boolean
}

/** Opening base in account currency cents; credit balances represent available cupo. */
export function accountBalanceBase(account: BalanceAccount): number {
  if (!account.isInvestment
    && (account.accountType === 'Crédito' || account.accountType === 'credit')
    && account.creditLimit !== null && account.creditLimit > 0) {
    return account.creditLimit
  }
  return account.initialBalance
}
