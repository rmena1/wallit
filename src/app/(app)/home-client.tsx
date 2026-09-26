'use client'

import { useState, memo, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { logout } from '@/lib/actions/auth'
import { getMovementsPaginated } from '@/lib/actions/movements'
import { settleReceivableWithNewMovement, settleReceivableWithExistingMovement, settleReceivableWithCrossSpacePayment } from '@/lib/actions/review'
import { formatDateDisplay, formatCurrency, formatMovementDisplayAmount, parseMoney, today } from '@/lib/utils'
import type { AccountWithBalanceSerialized as AccountWithBalance, NetLiquidityData } from '@/lib/actions/balances'

interface MovementWithCategory {
  id: string
  spaceId: string
  categoryId: string | null
  accountId: string | null
  name: string
  date: string
  amount: number
  amountUsd: number | null
  exchangeRate: number | null
  type: 'income' | 'expense'
  reportable: boolean
  createdAt: string  // ISO string (serialized from Date for client component)
  updatedAt: string  // ISO string (serialized from Date for client component)
  categoryName: string | null
  categoryEmoji: string | null
  accountBankName: string | null
  accountLastFour: string | null
  accountColor: string | null
  accountEmoji: string | null
  currency: 'CLP' | 'USD'
  receivable: boolean
  received: boolean
  receivableId: string | null
  time: string | null
  originalName: string | null
  transferId: string | null
  transferOtherSpaceName: string | null
}

interface UserAccount {
  id: string
  bankName: string
  lastFourDigits: string
  emoji: string | null
  currency: 'CLP' | 'USD'
}

interface UnlinkedIncome {
  kind: 'income' | 'transfer'
  id: string
  name: string
  date: string
  amount: number
  amountUsd: number | null
  currency: 'CLP' | 'USD'
  accountBankName: string | null
  accountLastFour: string | null
  accountEmoji: string | null
  categoryName: string | null
  categoryEmoji: string | null
  sourceSpaceId: string | null
  sourceSpaceName: string | null
  sourceSpaceEmoji: string | null
}

interface SettlementSpace {
  id: string
  name: string
  emoji: string
  isCurrent: boolean
  hasAccounts: boolean
}

interface SettlementAccount {
  id: string
  spaceId: string
  bankName: string
  lastFourDigits: string
  emoji: string | null
  currency: 'CLP' | 'USD'
}

interface HomePageProps {
  email: string
  accountBalances: AccountWithBalance[]
  totalBalance: number
  totalIncome: number
  totalExpense: number
  movements: MovementWithCategory[]
  currentSpaceId: string
  pendingReviewCount: number
  usdClpRate: number | null
  netLiquidity: NetLiquidityData
  userAccounts: UserAccount[]
  recentUnlinkedIncomes: UnlinkedIncome[]
  settlementSpaces: SettlementSpace[]
  settlementAccounts: SettlementAccount[]
  unsettledEmergencyCount: number
  unsettledLoanCount: number
}
// Memoized movement card component to prevent unnecessary re-renders
interface MovementCardProps {
  movement: MovementWithCategory
  isMarking: boolean
  onOpenPaymentDialog: (id: string) => void
  onNavigate: (id: string) => void
}

const MovementCard = memo(function MovementCard({ movement: m, isMarking, onOpenPaymentDialog, onNavigate }: MovementCardProps) {
  const isTransfer = !!m.transferId
  const displaysUsdAmount = m.currency === 'USD' && m.amountUsd != null

  return (
    <div
      style={{
        backgroundColor: isTransfer ? '#1a1a2a' : m.receivable && !m.received ? '#2a2000' : m.received ? '#1a1a1a' : '#1a1a1a',
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
        border: isTransfer ? '1px solid #3b4d8a' : m.receivable && !m.received ? '1px solid #854d0e' : '1px solid #2a2a2a',
        opacity: isMarking ? 0.4 : m.received ? 0.5 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      {m.receivable && !m.received && !isTransfer && (
        <button
          type="button"
          aria-label={`Marcar como cobrado ${m.name}`}
          onClick={() => onOpenPaymentDialog(m.id)}
          disabled={isMarking}
          style={{
            width: 24, height: 24, borderRadius: 6,
            border: '2px solid #fbbf24', backgroundColor: 'transparent',
            cursor: isMarking ? 'not-allowed' : 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="Marcar como cobrado"
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
        {m.received && !isTransfer && (
          <div style={{
            width: 24, height: 24, borderRadius: 6,
            border: '2px solid #4ade80', backgroundColor: '#052e16',
            flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, color: '#4ade80',
          }}>✓</div>
        )}
        <button
          type="button"
          aria-label={`Editar movimiento ${m.name}`}
          onClick={() => onNavigate(m.id)}
          style={{
            width: '100%',
            minWidth: 0,
            font: 'inherit',
            textAlign: 'left',
            color: 'inherit',
            backgroundColor: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            textDecoration: m.received ? 'line-through' : 'none',
          }}
        >
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          backgroundColor: isTransfer ? '#1e3a5f' : m.categoryEmoji ? '#27272a' : (m.type === 'income' ? '#052e16' : '#450a0a'),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, flexShrink: 0,
        }}>
          {isTransfer ? '↔️' : m.categoryEmoji || (m.type === 'income' ? '↑' : '↓')}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 500, color: '#e5e5e5',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {m.name}
          </div>
          {m.originalName && m.originalName !== m.name && (
            <div style={{ fontSize: 11, color: '#71717a', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {m.originalName}
            </div>
          )}
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 1 }}>
            {formatDateDisplay(m.date)}{m.time && ` · ${m.time}`}
            {!isTransfer && m.categoryName && (
              <span> · {m.categoryName}</span>
            )}
            {isTransfer && m.transferOtherSpaceName && (
              <span style={{ color: '#60a5fa' }}> · {m.type === 'expense' ? 'a' : 'desde'} {m.transferOtherSpaceName}</span>
            )}
            {isTransfer && (
              <span style={{ color: m.reportable ? '#22c55e' : '#a1a1aa' }}>
                {' '}· {m.reportable ? `${m.type === 'expense' ? 'gasto' : 'ingreso'} reportable${m.categoryName ? ` · ${m.categoryName}` : ''}` : 'operacional'}
              </span>
            )}
            {m.accountBankName && (
              <span style={{ color: isTransfer ? '#60a5fa' : m.accountColor || undefined }}> · {m.accountEmoji || ''} {m.accountBankName} ···{m.accountLastFour}</span>
            )}
          </div>
        </div>
      <div style={{ flexShrink: 0, marginLeft: 8 }}>
        <span style={{
          fontSize: 15, fontWeight: 600,
          color: isTransfer ? '#60a5fa' : m.type === 'income' ? '#4ade80' : '#f87171',
          whiteSpace: 'nowrap',
        }}>
          {isTransfer ? '' : m.type === 'income' ? '+' : '-'}{formatMovementDisplayAmount(m.amount, m.amountUsd, m.currency)}
        </span>
        {displaysUsdAmount && (
          <div style={{ fontSize: 11, color: '#52525b', textAlign: 'right', marginTop: 1 }}>
            USD
          </div>
        )}
      </div>
        </button>
      </div>
    </div>
  )
})

function getAccountIconFromType(accountType: string): string {
  // Support both Spanish (current) and English (legacy) account types
  switch (accountType) {
    case 'Crédito':
    case 'credit': return '💳'
    case 'Corriente':
    case 'debit': return '🏦'
    case 'Vista': return '👁️'
    case 'Ahorro': return '🐷'
    case 'Prepago': return '💵'
    default: return '🏦'
  }
}

const PAGE_SIZE = 20

function centsToInputValue(cents: number, currency: 'CLP' | 'USD'): string {
  return currency === 'USD' ? (cents / 100).toFixed(2) : String(Math.round(cents / 100))
}

function defaultSettlementAmount(receivable: MovementWithCategory, accountCurrency: 'CLP' | 'USD', usdClpRate: number | null): number {
  if (accountCurrency === 'CLP') return receivable.amount
  if (receivable.currency === 'USD' && receivable.amountUsd != null) return receivable.amountUsd
  const rate = receivable.exchangeRate ?? usdClpRate
  return rate ? Math.max(1, Math.round(receivable.amount * 100 / rate)) : 0
}

export function HomePage({ email, accountBalances, totalBalance, totalIncome, totalExpense, movements: initialMovements, currentSpaceId, pendingReviewCount, usdClpRate, netLiquidity, userAccounts, recentUnlinkedIncomes, settlementSpaces, settlementAccounts, unsettledEmergencyCount, unsettledLoanCount }: HomePageProps) {
  const router = useRouter()
  const [receivableFilter, setReceivableFilter] = useState(false)
  const [markingReceived, setMarkingReceived] = useState<string | null>(null)
  const [paymentDialogId, setPaymentDialogId] = useState<string | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('cash')
  const [paymentMode, setPaymentMode] = useState<'new' | 'existing'>('new')
  const [newPaymentSource, setNewPaymentSource] = useState<'current-space' | 'other-space'>('current-space')
  const [selectedExistingIncomeId, setSelectedExistingIncomeId] = useState<string | null>(null)
  const [crossSpaceId, setCrossSpaceId] = useState('')
  const [crossSourceAccountId, setCrossSourceAccountId] = useState('')
  const [crossDestinationAccountId, setCrossDestinationAccountId] = useState('')
  const [crossAmount, setCrossAmount] = useState('')
  const [crossDate, setCrossDate] = useState(today())
  const [showUserMenu, setShowUserMenu] = useState(false)
  const reviewCount = pendingReviewCount
  const userInitial = email.charAt(0).toUpperCase()

  // Pagination state
  const [displayedMovements, setDisplayedMovements] = useState<MovementWithCategory[]>(initialMovements)
  const [hasMore, setHasMore] = useState(initialMovements.length >= PAGE_SIZE)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [offset, setOffset] = useState(initialMovements.length)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const previousSpaceIdRef = useRef(currentSpaceId)
  
  // Track if this is the initial mount to skip unnecessary refetch
  const isInitialMount = useRef(true)

  // Reset movements when filter changes (fetch from backend)
  // Skip on initial mount since we already have SSR data for the default filter (all)
  useEffect(() => {
    // On initial mount with default filter, we already have SSR data - skip fetch
    if (isInitialMount.current) {
      isInitialMount.current = false
      // Only skip if filter is 'all' (default) - we have this data from SSR
      if (!receivableFilter) {
        return
      }
    }
    
    async function fetchFiltered() {
      setIsLoadingMore(true)
      try {
        const result = await getMovementsPaginated(0, PAGE_SIZE, receivableFilter ? 'receivables' : 'all')
        setDisplayedMovements(result.data)
        setHasMore(result.hasMore)
        setOffset(result.data.length)
      } finally {
        setIsLoadingMore(false)
      }
    }
    fetchFiltered()
  }, [receivableFilter])

  // Reset client-side pagination only when the active Space changes. Server actions can
  // refresh the route with new props; blindly resetting on every movements prop change
  // would undo local optimistic UI such as removing settled receivables from the filter.
  useEffect(() => {
    if (previousSpaceIdRef.current === currentSpaceId) return
    previousSpaceIdRef.current = currentSpaceId
    setDisplayedMovements(initialMovements)
    setHasMore(initialMovements.length >= PAGE_SIZE)
    setOffset(initialMovements.length)
    setReceivableFilter(false)
  }, [currentSpaceId, initialMovements])

  // Load more movements when scrolling to bottom
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return
    setIsLoadingMore(true)
    try {
      const result = await getMovementsPaginated(offset, PAGE_SIZE, receivableFilter ? 'receivables' : 'all')
      setDisplayedMovements(prev => [...prev, ...result.data])
      setHasMore(result.hasMore)
      setOffset(prev => prev + result.data.length)
    } finally {
      setIsLoadingMore(false)
    }
  }, [isLoadingMore, hasMore, offset, receivableFilter])

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          loadMore()
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [hasMore, isLoadingMore, loadMore])

  // Use displayed movements (managed state) instead of prop
  const filteredMovements = displayedMovements
  const paymentReceivable = paymentDialogId
    ? displayedMovements.find((movement) => movement.id === paymentDialogId) ?? initialMovements.find((movement) => movement.id === paymentDialogId) ?? null
    : null
  const otherSpaces = settlementSpaces.filter((space) => !space.isCurrent)
  const currentDestinationAccounts = settlementAccounts.filter((account) => account.spaceId === currentSpaceId)
  const crossSourceAccounts = settlementAccounts.filter((account) => account.spaceId === crossSpaceId)
  const selectedDestinationAccount = settlementAccounts.find((account) => account.id === crossDestinationAccountId) ?? currentDestinationAccounts[0] ?? null

  // Stable callback for opening payment dialog
  const openPaymentDialog = useCallback((id: string) => {
    setSelectedAccountId('cash')
    setPaymentMode('new')
    setNewPaymentSource('current-space')
    setSelectedExistingIncomeId(null)
    setCrossDate(today())
    setPaymentDialogId(id)
  }, [])

  useEffect(() => {
    if (!paymentDialogId) return
    const firstOtherSpace = otherSpaces[0]
    if (otherSpaces.length === 1) {
      setCrossSpaceId(otherSpaces[0].id)
    } else if (!firstOtherSpace) {
      setCrossSpaceId('')
    } else if (!otherSpaces.some((space) => space.id === crossSpaceId)) {
      setCrossSpaceId(firstOtherSpace.id)
    }
  }, [paymentDialogId, otherSpaces, crossSpaceId])

  useEffect(() => {
    if (!paymentDialogId) return
    const firstSourceAccount = crossSourceAccounts[0]
    if (!firstSourceAccount) {
      setCrossSourceAccountId('')
    } else if (!crossSourceAccounts.some((account) => account.id === crossSourceAccountId)) {
      setCrossSourceAccountId(firstSourceAccount.id)
    }
  }, [paymentDialogId, crossSourceAccounts, crossSourceAccountId])

  useEffect(() => {
    if (!paymentDialogId) return
    const firstDestinationAccount = currentDestinationAccounts[0]
    if (!firstDestinationAccount) {
      setCrossDestinationAccountId('')
    } else if (!currentDestinationAccounts.some((account) => account.id === crossDestinationAccountId)) {
      setCrossDestinationAccountId(firstDestinationAccount.id)
    }
  }, [paymentDialogId, currentDestinationAccounts, crossDestinationAccountId])

  useEffect(() => {
    if (!paymentDialogId || !paymentReceivable || !selectedDestinationAccount) return
    const amount = defaultSettlementAmount(paymentReceivable, selectedDestinationAccount.currency, usdClpRate)
    setCrossAmount(amount > 0 ? centsToInputValue(amount, selectedDestinationAccount.currency) : '')
  }, [paymentDialogId, paymentReceivable, selectedDestinationAccount, usdClpRate])

  // Stable callback for navigating to edit
  const handleNavigateToEdit = useCallback((id: string) => {
    router.push(`/edit/${id}`)
  }, [router])

  async function handleConfirmPayment() {
    if (!paymentDialogId) return
    const id = paymentDialogId
    setPaymentDialogId(null)
    setMarkingReceived(id)
    try {
      const result = paymentMode === 'existing' && selectedExistingIncomeId
        ? await settleReceivableWithExistingMovement(id, selectedExistingIncomeId)
        : newPaymentSource === 'other-space'
          ? await settleReceivableWithCrossSpacePayment(id, {
            payingSpaceId: crossSpaceId,
            sourceAccountId: crossSourceAccountId,
            destinationAccountId: crossDestinationAccountId,
            amount: parseMoney(crossAmount),
            date: crossDate,
          })
          : await settleReceivableWithNewMovement(id, selectedAccountId === 'cash' ? undefined : selectedAccountId)
      if (!result.success) {
        alert(result.error || 'Error al marcar como cobrado')
        return
      }
      // Update local state: mark as received or remove if receivables filter is on
      setDisplayedMovements(prev => {
        if (receivableFilter) {
          // Remove from list when filtering by receivables
          return prev.filter(m => m.id !== id)
        } else {
          // Mark as received in the list
          return prev.map(m => m.id === id ? { ...m, received: true } : m)
        }
      })
    } finally {
      setMarkingReceived(null)
    }
  }

  const canConfirmCrossSpacePayment = otherSpaces.length > 0 && Boolean(crossSpaceId && crossSourceAccountId && crossDestinationAccountId && crossDate && parseMoney(crossAmount) > 0)
  const canConfirmPayment = paymentMode === 'new'
    ? newPaymentSource === 'current-space' || canConfirmCrossSpacePayment
    : selectedExistingIncomeId !== null
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
        <div style={{ maxWidth: 540, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}>
              💰
            </div>
            <span style={{ fontSize: 17, fontWeight: 700, color: '#f5f5f5' }}>wallit</span>
            {usdClpRate !== null && (
              <span style={{ fontSize: 12, color: '#22c55e', backgroundColor: '#1a2e1a', padding: '2px 8px', borderRadius: 6, fontWeight: 600, marginLeft: 4 }}>
                USD {formatCurrency(usdClpRate, 'CLP')}
              </span>
            )}
            {unsettledEmergencyCount > 0 && (
              <Link href="/emergency" style={{
                fontSize: 12, color: '#f87171', backgroundColor: '#2a1a1a',
                padding: '2px 8px', borderRadius: 6, fontWeight: 700, marginLeft: 4,
                textDecoration: 'none', border: '1px solid #dc262640',
              }}>
                🚨{unsettledEmergencyCount}
              </Link>
            )}
            {unsettledLoanCount > 0 && (
              <Link href="/loans" style={{
                fontSize: 12, color: '#93c5fd', backgroundColor: '#172554',
                padding: '2px 8px', borderRadius: 6, fontWeight: 700, marginLeft: 4,
                textDecoration: 'none', border: '1px solid #3b82f640',
              }}>
                🏦 Préstamos {unsettledLoanCount}
              </Link>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowUserMenu(m => !m)}
              style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                border: '2px solid #1e40af',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15, fontWeight: 700, color: '#fff', cursor: 'pointer',
              }}
              title={email}
            >
              {userInitial}
            </button>
            {showUserMenu && (
              <>
                <div
                  onClick={() => setShowUserMenu(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 19 }}
                />
                <div style={{
                  position: 'absolute', top: 44, right: 0, zIndex: 20,
                  backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a',
                  borderRadius: 12, padding: '8px 0', minWidth: 180,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}>
                  <div style={{ padding: '8px 14px', borderBottom: '1px solid #2a2a2a', marginBottom: 4 }}>
                    <div style={{ fontSize: 13, color: '#a1a1aa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {email}
                    </div>
                  </div>
                  <button
                    onClick={() => { setShowUserMenu(false); router.push('/settings') }}
                    style={{
                      width: '100%', padding: '10px 14px', border: 'none',
                      backgroundColor: 'transparent', color: '#e5e5e5',
                      fontSize: 14, cursor: 'pointer', textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#27272a')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    ⚙️ Configuración
                  </button>
                  <button
                    onClick={() => { setShowUserMenu(false); logout() }}
                    style={{
                      width: '100%', padding: '10px 14px', border: 'none',
                      backgroundColor: 'transparent', color: '#f87171',
                      fontSize: 14, cursor: 'pointer', textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#27272a')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    🚪 Cerrar sesión
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main style={{ maxWidth: 540, margin: '0 auto', padding: '16px 16px 96px' }}>
        {/* Total Balance Card — only show when user has accounts */}
        {accountBalances.length > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)',
          borderRadius: 20, padding: '20px 20px 16px', marginBottom: 16,
          color: '#fff',
          border: '1px solid #2a2a2a',
        }}>
          <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 4 }}>Balance General</div>
          <div style={{
            fontSize: 32, fontWeight: 700, letterSpacing: '-0.5px',
            color: totalBalance >= 0 ? '#4ade80' : '#f87171',
            whiteSpace: 'nowrap',
          }}>
            {formatCurrency(totalBalance, 'CLP')}
          </div>
          <div style={{
            display: 'flex', gap: 16, marginTop: 16, paddingTop: 16,
            borderTop: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 2 }}>Ingresos</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#4ade80', whiteSpace: 'nowrap' }}>
                {formatCurrency(totalIncome, 'CLP')}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 2 }}>Gastos</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#f87171', whiteSpace: 'nowrap' }}>
                {formatCurrency(totalExpense, 'CLP')}
              </div>
            </div>
          </div>
        </div>
        )}

        {accountBalances.length > 0 && (
          <div style={{
            backgroundColor: '#1a1a2e', borderRadius: 14, padding: '14px 16px',
            marginBottom: 16, border: '1px solid #2f2f4a',
          }}>
            <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 6, fontWeight: 500 }}>
              💧 Liquidez Neta
            </div>
            <div style={{
              fontSize: 22, fontWeight: 700,
              color: netLiquidity.netLiquidity >= 0 ? '#4ade80' : '#f87171',
              marginBottom: 8,
            }}>
              {formatCurrency(netLiquidity.netLiquidity, 'CLP')}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: '#9ca3af' }}>
              <span>Débito: {formatCurrency(netLiquidity.debitBalance, 'CLP')}</span>
              <span>·</span>
              <span>Por cobrar: {formatCurrency(netLiquidity.receivables, 'CLP')}</span>
              <span>·</span>
              <span>Préstamos: {formatCurrency(netLiquidity.unsettledLoans, 'CLP')}</span>
              <span>·</span>
              <span>Deuda: {formatCurrency(netLiquidity.creditDebt, 'CLP')}</span>
            </div>
          </div>
        )}

        {/* Account Cards */}
        {accountBalances.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: '#e5e5e5', margin: '0 0 10px' }}>
              Cuentas
            </h2>
            <div style={{
              display: 'flex',
              gap: 10,
              overflowX: 'auto',
              paddingBottom: 4,
              scrollbarWidth: 'none',
            }}>
              {accountBalances.map((acc) => {
                const showInvestmentBadge = Boolean(acc.isInvestment && acc.totalDeposited > 0)
                const gainLossPercent = showInvestmentBadge ? acc.gainLossPercent : 0
                const gainLossSign = gainLossPercent > 0 ? '+' : ''
                const gainLossColor = gainLossPercent >= 0 ? '#4ade80' : '#f87171'
                const gainLossBg = gainLossPercent >= 0 ? '#052e16' : '#450a0a'

                return (
                  <div key={acc.id} data-testid={`account-card-${acc.id}`} onClick={() => router.push(`/account/${acc.id}`)} style={{
                    minWidth: 160,
                    backgroundColor: '#1a1a1a',
                    borderRadius: 14,
                    padding: '14px 14px 12px',
                    border: `1px solid ${acc.color ? acc.color + '40' : '#2a2a2a'}`,
                    flexShrink: 0,
                    cursor: 'pointer',
                    position: 'relative',
                  }}>
                    {showInvestmentBadge && (
                      <span style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        backgroundColor: gainLossBg,
                        color: gainLossColor,
                        border: `1px solid ${gainLossColor}66`,
                        fontSize: 10,
                        fontWeight: 700,
                        borderRadius: 999,
                        padding: '2px 6px',
                      }}>
                        {gainLossSign}{gainLossPercent.toFixed(1)}%
                      </span>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 16 }}>{acc.emoji || getAccountIconFromType(acc.accountType)}</span>
                      <span style={{ fontSize: 12, color: acc.color || '#a1a1aa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {acc.bankName}
                      </span>
                    </div>
                    <div style={{
                      fontSize: 18, fontWeight: 700,
                      color: acc.balance >= 0 ? '#e5e5e5' : '#f87171',
                      whiteSpace: 'nowrap',
                      marginBottom: 4,
                    }}>
                      {formatCurrency(acc.balance, acc.currency)}
                    </div>
                    {(acc.accountType === 'Crédito' || acc.accountType === 'credit') && acc.creditLimit && acc.creditLimit > 0 && (
                      <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 2 }}>
                        Cupo: {formatCurrency(Math.max(0, acc.creditLimit - acc.balance), acc.currency)} / {formatCurrency(acc.creditLimit, acc.currency)}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>
                      {acc.accountType} · ···{acc.lastFourDigits}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* No accounts — welcoming onboarding empty state */}
        {accountBalances.length === 0 && (
          <div style={{
            background: 'linear-gradient(135deg, #18181b 0%, #1a2e1a 100%)',
            borderRadius: 20,
            padding: '48px 24px', textAlign: 'center',
            border: '1px solid #2a3a2a', marginBottom: 20,
          }}>
            <span style={{ fontSize: 56, display: 'block', marginBottom: 16 }}>💰</span>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#f5f5f5', marginBottom: 8 }}>
              ¡Bienvenido a Wallit!
            </div>
            <div style={{ fontSize: 15, color: '#a1a1aa', marginBottom: 28, lineHeight: 1.5 }}>
              Agrega tu primera cuenta bancaria para empezar a rastrear ingresos, gastos y tu balance en tiempo real.
            </div>
            <a
              href="/settings"
              style={{
                display: 'block',
                padding: '14px 24px', borderRadius: 14, border: 'none',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(34,197,94,0.3)',
                textDecoration: 'none',
              }}
            >
              Agregar Cuenta →
            </a>
          </div>
        )}

        {/* Review Banner */}
        {reviewCount > 0 && (
          <a href="/review" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: '#1a1a0a', borderRadius: 14, padding: '14px 16px',
            border: '1px solid #854d0e', marginBottom: 16,
            textDecoration: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #1a1a0a, #27200a)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>👀</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#fbbf24' }}>
                  {reviewCount} movimiento{reviewCount !== 1 ? 's' : ''} pendiente{reviewCount !== 1 ? 's' : ''} de revisión
                </div>
                <div style={{ fontSize: 12, color: '#a18329', marginTop: 2 }}>
                  Toca para revisar
                </div>
              </div>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </a>
        )}

        {/* Recent Movements — only show when user has accounts */}
        {accountBalances.length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: '#e5e5e5', margin: 0 }}>
              Movimientos Recientes
            </h2>
            <button
              onClick={() => setReceivableFilter(f => !f)}
              style={{
                padding: '4px 12px', borderRadius: 8, border: 'none',
                backgroundColor: receivableFilter ? '#92400e' : '#27272a',
                color: receivableFilter ? '#fbbf24' : '#a1a1aa',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              💰 Por cobrar
            </button>
          </div>

          {filteredMovements.length === 0 ? (
            <div style={{
              backgroundColor: '#1a1a1a', borderRadius: 16,
              padding: '40px 20px', textAlign: 'center', color: '#a1a1aa',
              border: '1px solid #2a2a2a',
            }}>
              <span style={{ fontSize: 40, display: 'block', marginBottom: 8 }}>📊</span>
              <span style={{ fontSize: 14 }}>Sin movimientos aún</span>
              <a
                href="/add"
                style={{
                  display: 'inline-block', marginTop: 12,
                  padding: '8px 20px', borderRadius: 10, border: 'none',
                  background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                  color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  textDecoration: 'none',
                }}
              >
                Agregar Movimiento
              </a>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredMovements.map((m) => (
                <MovementCard
                  key={m.id}
                  movement={m}
                  isMarking={markingReceived === m.id}
                  onOpenPaymentDialog={openPaymentDialog}
                  onNavigate={handleNavigateToEdit}
                />
              ))}
              
              {/* Load more trigger */}
              <div ref={loadMoreRef} style={{ padding: '20px 0', textAlign: 'center' }}>
                {isLoadingMore && (
                  <div style={{ color: '#a1a1aa', fontSize: 13 }}>Cargando más...</div>
                )}
                {!hasMore && filteredMovements.length > 0 && (
                  <div style={{ color: '#9ca3af', fontSize: 12 }}>No hay más movimientos</div>
                )}
              </div>
            </div>
          )}
        </div>
        )}
      </main>

      {/* Payment Dialog */}
      {paymentDialogId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-dialog-title"
          onClick={() => setPaymentDialogId(null)}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 100, padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              backgroundColor: '#1a1a1a', borderRadius: 20, padding: 24,
              border: '1px solid #2a2a2a', width: '100%', maxWidth: 380,
              maxHeight: '90dvh', overflowY: 'auto',
            }}
          >
            <div id="payment-dialog-title" style={{ fontSize: 18, fontWeight: 700, color: '#e5e5e5', marginBottom: 4 }}>
              💰 Cobrar gasto
            </div>
            <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 16 }}>
              ¿Cómo registrar el cobro?
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid #2a2a2a' }}>
              <button
                onClick={() => setPaymentMode('new')}
                style={{
                  flex: 1, padding: '10px 8px', border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                  backgroundColor: paymentMode === 'new' ? '#27272a' : '#111',
                  color: paymentMode === 'new' ? '#4ade80' : '#a1a1aa',
                  borderBottom: paymentMode === 'new' ? '2px solid #4ade80' : '2px solid transparent',
                  transition: 'all 0.15s ease',
                }}
              >
                Nuevo ingreso
              </button>
              <button
                onClick={() => setPaymentMode('existing')}
                style={{
                  flex: 1, padding: '10px 8px', border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                  backgroundColor: paymentMode === 'existing' ? '#27272a' : '#111',
                  color: paymentMode === 'existing' ? '#4ade80' : '#a1a1aa',
                  borderBottom: paymentMode === 'existing' ? '2px solid #4ade80' : '2px solid transparent',
                  transition: 'all 0.15s ease',
                }}
              >
                Vincular existente
              </button>
            </div>

            {paymentMode === 'new' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              <div style={{ fontSize: 12, color: '#a1a1aa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0 }}>
                En este Space
              </div>
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                  backgroundColor: newPaymentSource === 'current-space' && selectedAccountId === 'cash' ? '#27272a' : 'transparent',
                  border: newPaymentSource === 'current-space' && selectedAccountId === 'cash' ? '1px solid #4ade80' : '1px solid #2a2a2a',
                  transition: 'all 0.15s ease',
                }}
              >
                <input
                  type="radio" name="paymentAccount" value="cash"
                  checked={newPaymentSource === 'current-space' && selectedAccountId === 'cash'}
                  onChange={() => { setNewPaymentSource('current-space'); setSelectedAccountId('cash') }}
                  style={{ display: 'none' }}
                />
                <span style={{ fontSize: 20 }}>💵</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e5e5' }}>Efectivo</div>
                  <div style={{ fontSize: 11, color: '#a1a1aa' }}>No genera movimiento de ingreso</div>
                </div>
                {newPaymentSource === 'current-space' && selectedAccountId === 'cash' && (
                  <span style={{ marginLeft: 'auto', color: '#4ade80', fontSize: 16 }}>✓</span>
                )}
              </label>

              {userAccounts.map(acc => (
                <label
                  key={acc.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                    backgroundColor: newPaymentSource === 'current-space' && selectedAccountId === acc.id ? '#27272a' : 'transparent',
                    border: newPaymentSource === 'current-space' && selectedAccountId === acc.id ? '1px solid #4ade80' : '1px solid #2a2a2a',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <input
                    type="radio" name="paymentAccount" value={acc.id}
                    checked={newPaymentSource === 'current-space' && selectedAccountId === acc.id}
                    onChange={() => { setNewPaymentSource('current-space'); setSelectedAccountId(acc.id) }}
                    style={{ display: 'none' }}
                  />
                  <span style={{ fontSize: 20 }}>{acc.emoji || '🏦'}</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e5e5' }}>{acc.bankName}</div>
                    <div style={{ fontSize: 11, color: '#a1a1aa' }}>···{acc.lastFourDigits} · {acc.currency}</div>
                  </div>
                  {newPaymentSource === 'current-space' && selectedAccountId === acc.id && (
                    <span style={{ marginLeft: 'auto', color: '#4ade80', fontSize: 16 }}>✓</span>
                  )}
                </label>
              ))}

              <div
                style={{
                  marginTop: 8,
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: newPaymentSource === 'other-space' ? '1px solid #4ade80' : '1px solid #2a2a2a',
                  backgroundColor: newPaymentSource === 'other-space' ? '#17251d' : 'transparent',
                  opacity: otherSpaces.length === 0 ? 0.55 : 1,
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: otherSpaces.length === 0 ? 'not-allowed' : 'pointer', marginBottom: 12 }}>
                  <input
                    type="radio"
                    name="paymentAccount"
                    value="other-space"
                    disabled={otherSpaces.length === 0}
                    checked={newPaymentSource === 'other-space'}
                    onChange={() => setNewPaymentSource('other-space')}
                    style={{ display: 'none' }}
                  />
                  <span style={{ fontSize: 20 }}>↘</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#e5e5e5' }}>Pago desde otro Space</div>
                    <div style={{ fontSize: 11, color: '#a1a1aa' }}>
                      {otherSpaces.length === 0 ? 'No hay otros Spaces disponibles' : 'Crea gasto pendiente desde el otro Space'}
                    </div>
                  </div>
                  {newPaymentSource === 'other-space' && (
                    <span style={{ color: '#4ade80', fontSize: 16 }}>✓</span>
                  )}
                </label>

                <div style={{ display: 'grid', gap: 10 }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#a1a1aa' }}>
                    Space que paga
                    <select
                      aria-label="Space que paga"
                      value={crossSpaceId}
                      disabled={otherSpaces.length === 0}
                      onChange={(event) => { setNewPaymentSource('other-space'); setCrossSpaceId(event.target.value) }}
                      style={{ height: 38, borderRadius: 10, border: '1px solid #2a2a2a', backgroundColor: '#111', color: '#e5e5e5', padding: '0 10px' }}
                    >
                      {otherSpaces.length === 0 ? (
                        <option value="">Sin otros Spaces</option>
                      ) : (
                        otherSpaces.map((space) => (
                          <option key={space.id} value={space.id} disabled={!space.hasAccounts}>
                            {space.emoji} {space.name}{space.hasAccounts ? '' : ' · sin cuentas'}
                          </option>
                        ))
                      )}
                    </select>
                  </label>

                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#a1a1aa' }}>
                    Cuenta origen
                    <select
                      aria-label="Cuenta origen para el pago"
                      value={crossSourceAccountId}
                      disabled={otherSpaces.length === 0 || crossSourceAccounts.length === 0}
                      onChange={(event) => { setNewPaymentSource('other-space'); setCrossSourceAccountId(event.target.value) }}
                      style={{ height: 38, borderRadius: 10, border: '1px solid #2a2a2a', backgroundColor: '#111', color: '#e5e5e5', padding: '0 10px' }}
                    >
                      {crossSourceAccounts.length === 0 ? (
                        <option value="">Sin cuentas origen</option>
                      ) : (
                        crossSourceAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.emoji || '🏦'} {account.bankName} ···{account.lastFourDigits} · {account.currency}
                          </option>
                        ))
                      )}
                    </select>
                  </label>

                  <label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#a1a1aa' }}>
                    Cuenta destino
                    <select
                      aria-label="Cuenta destino del Space actual"
                      value={crossDestinationAccountId}
                      disabled={currentDestinationAccounts.length === 0}
                      onChange={(event) => { setNewPaymentSource('other-space'); setCrossDestinationAccountId(event.target.value) }}
                      style={{ height: 38, borderRadius: 10, border: '1px solid #2a2a2a', backgroundColor: '#111', color: '#e5e5e5', padding: '0 10px' }}
                    >
                      {currentDestinationAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.emoji || '🏦'} {account.bankName} ···{account.lastFourDigits} · {account.currency}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#a1a1aa' }}>
                      Monto recibido
                      <input
                        aria-label="Monto recibido desde otro Space"
                        value={crossAmount}
                        disabled={otherSpaces.length === 0}
                        onFocus={() => setNewPaymentSource('other-space')}
                        onChange={(event) => setCrossAmount(event.target.value)}
                        inputMode="decimal"
                        style={{ height: 38, borderRadius: 10, border: '1px solid #2a2a2a', backgroundColor: '#111', color: '#e5e5e5', padding: '0 10px', minWidth: 0 }}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#a1a1aa' }}>
                      Fecha pago
                      <input
                        aria-label="Fecha de pago desde otro Space"
                        type="date"
                        value={crossDate}
                        disabled={otherSpaces.length === 0}
                        onFocus={() => setNewPaymentSource('other-space')}
                        onChange={(event) => setCrossDate(event.target.value)}
                        style={{ height: 38, borderRadius: 10, border: '1px solid #2a2a2a', backgroundColor: '#111', color: '#e5e5e5', padding: '0 10px', minWidth: 0 }}
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
            ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24, maxHeight: 280, overflowY: 'auto' }}>
              {recentUnlinkedIncomes.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 13 }}>
                  No hay ingresos recientes sin vincular
                </div>
              ) : (
                recentUnlinkedIncomes.map(inc => (
                  <label
                    key={inc.id}
                    role="radio"
                    aria-checked={selectedExistingIncomeId === inc.id}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedExistingIncomeId(inc.id)
                      }
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                      backgroundColor: selectedExistingIncomeId === inc.id ? '#27272a' : 'transparent',
                      border: selectedExistingIncomeId === inc.id ? '1px solid #4ade80' : '1px solid #2a2a2a',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="radio" name="existingIncome" value={inc.id}
                      checked={selectedExistingIncomeId === inc.id}
                      onChange={() => setSelectedExistingIncomeId(inc.id)}
                      style={{ display: 'none' }}
                    />
                    <span style={{ fontSize: 16 }}>{inc.kind === 'transfer' ? '↔' : inc.categoryEmoji || '↑'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e5e5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {inc.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#a1a1aa' }}>
                        {formatDateDisplay(inc.date)}
                        {inc.kind === 'transfer' && inc.sourceSpaceName && (
                          <span style={{ color: '#60a5fa' }}> · desde {inc.sourceSpaceEmoji || ''} {inc.sourceSpaceName}</span>
                        )}
                        {inc.accountBankName && <span> · {inc.accountEmoji || ''} {inc.accountBankName}</span>}
                      </div>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#4ade80', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {inc.kind === 'transfer' ? 'Disponible ' : '+'}{formatMovementDisplayAmount(inc.amount, inc.amountUsd, inc.currency)}
                    </span>
                    {selectedExistingIncomeId === inc.id && (
                      <span style={{ color: '#4ade80', fontSize: 16, flexShrink: 0 }}>✓</span>
                    )}
                  </label>
                ))
              )}
            </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setPaymentDialogId(null)}
                style={{
                  flex: 1, padding: '12px', borderRadius: 12,
                  border: '1px solid #2a2a2a', backgroundColor: '#111',
                  color: '#a1a1aa', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmPayment}
                disabled={!canConfirmPayment}
                style={{
                  flex: 1, padding: '12px', borderRadius: 12,
                  border: 'none',
                  background: canConfirmPayment ? 'linear-gradient(135deg, #22c55e, #16a34a)' : '#27272a',
                  color: canConfirmPayment ? '#fff' : '#9ca3af',
                  fontSize: 14, fontWeight: 600,
                  cursor: canConfirmPayment ? 'pointer' : 'not-allowed',
                  boxShadow: canConfirmPayment ? '0 2px 8px rgba(34,197,94,0.25)' : 'none',
                }}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
