'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { formatCurrency } from '@/lib/utils'
import { getReportData, getHistoricalExpenseProfile, type ReportData, type DailyData, type HistoricalExpenseProfile } from '@/lib/actions/reports'
import { getReportCategoryMovements, type ReportCategoryMovement } from '@/lib/actions/movements'
import {
  type TooltipContentProps,
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ─── Date helpers ────────────────────────────────────────────────────────────

function fmt(d: Date) {
  return d.toISOString().slice(0, 10)
}

function startOfWeek(d: Date) {
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1 // Monday = start
  const s = new Date(d)
  s.setDate(s.getDate() - diff)
  return s
}

type Preset = { label: string; getRange: () => [Date, Date] }

const PRESETS: Preset[] = [
  { label: 'Últimos 7 días', getRange: () => { const e = new Date(); const s = new Date(); s.setDate(e.getDate() - 6); return [s, e] } },
  { label: 'Últimos 30 días', getRange: () => { const e = new Date(); const s = new Date(); s.setDate(e.getDate() - 29); return [s, e] } },
  { label: 'Últimos 100 días', getRange: () => { const e = new Date(); const s = new Date(); s.setDate(e.getDate() - 99); return [s, e] } },
  { label: 'Esta semana', getRange: () => { const e = new Date(); return [startOfWeek(e), e] } },
  { label: 'Este mes', getRange: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), new Date(n.getFullYear(), n.getMonth() + 1, 0)] } },
  { label: 'Este año', getRange: () => { const n = new Date(); return [new Date(n.getFullYear(), 0, 1), new Date(n.getFullYear(), 11, 31)] } },
]

function daysInRange(start: string, end: string): string[] {
  const days: string[] = []
  const d = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  while (d <= e) {
    days.push(fmt(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

function formatShortDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'short',
  })
}

// ─── Chart data builders ─────────────────────────────────────────────────────

function getDayOfWeek(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00')
  const jsDay = d.getDay() // 0=Sunday
  return jsDay === 0 ? 6 : jsDay - 1 // 0=Monday, 6=Sunday
}

function buildExpenseChart(
  dailyData: DailyData[],
  startDate: string,
  endDate: string,
  historicalProfile: HistoricalExpenseProfile | null,
  isCurrentMonth: boolean
): { data: { date: string; label: string; actual: number | null; trend: number | null }[]; projectedTotal: number; predictionLevel: number } {
  const days = daysInRange(startDate, endDate)
  const map = new Map(dailyData.map(d => [d.date, d.expense]))
  const today = fmt(new Date())

  // Build cumulative actual values for all days up to today
  let cumulative = 0
  let totalActualExpense = 0
  let actualDaysCount = 0
  const cumulativeByDay = new Map<string, number>()

  for (const day of days) {
    if (day > today) break
    const val = map.get(day) || 0
    cumulative += val
    cumulativeByDay.set(day, cumulative)
    totalActualExpense = cumulative
    actualDaysCount++
  }

  // If not current month or no profile, no trend line
  if (!isCurrentMonth || !historicalProfile) {
    const data = days.map(day => {
      const isFuture = day > today
      return {
        date: day,
        label: day.slice(5),
        actual: isFuture ? null : (cumulativeByDay.get(day) || 0) / 100,
        trend: null,
      }
    })
    return { data, projectedTotal: 0, predictionLevel: 0 }
  }

  // Determine prediction level
  const monthCount = historicalProfile.monthCount
  const predictionLevel = monthCount < 2 ? 1 : monthCount < 4 ? 2 : 3

  // Number of days in current month
  const totalDaysInMonth = days.length
  const currentMonth = new Date(startDate + 'T00:00:00').getMonth()

  // ──────────────────────────────────────────────────────────────────────
  // CORE FIX: The trend line for past days MUST equal the actual cumulative.
  // The projected total is anchored to actual spending:
  //   projectedTotal = totalActualExpense + estimatedRemaining
  // ──────────────────────────────────────────────────────────────────────

  let projectedTotal = 0
  const trendByDay: number[] = new Array(totalDaysInMonth).fill(0)

  if (actualDaysCount <= 0 || totalActualExpense <= 0) {
    // No actual data yet — no meaningful trend
    const data = days.map(day => {
      const isFuture = day > today
      return {
        date: day,
        label: day.slice(5),
        actual: isFuture ? null : 0,
        trend: null,
      }
    })
    return { data, projectedTotal: 0, predictionLevel }
  }

  const todayIdx = actualDaysCount - 1

  // Past days (up to today): trend = actual cumulative (FACT)
  for (let i = 0; i <= todayIdx; i++) {
    trendByDay[i] = cumulativeByDay.get(days[i]) || 0
  }

  if (predictionLevel === 1) {
    // Level 1: daily average adjusted by day-of-week for future estimation
    const dailyAvg = totalActualExpense / actualDaysCount
    const dowProfile = historicalProfile.dayOfWeekProfile

    // Estimate remaining spending from tomorrow to end of month
    let estimatedRemaining = 0
    for (let i = todayIdx + 1; i < totalDaysInMonth; i++) {
      const dow = getDayOfWeek(days[i])
      estimatedRemaining += dailyAvg * dowProfile[dow]
    }

    projectedTotal = totalActualExpense + estimatedRemaining

    // Build future trend: cumulate from actual today value
    let runningTotal = totalActualExpense
    for (let i = todayIdx + 1; i < totalDaysInMonth; i++) {
      const dow = getDayOfWeek(days[i])
      runningTotal += dailyAvg * dowProfile[dow]
      trendByDay[i] = runningTotal
    }

  } else {
    // Level 2 & 3: normalized cumulative curve
    const profile = historicalProfile.dayOfMonthProfile

    // Build cumulative profile for days in this month
    const cumulativeProfile: number[] = []
    let profCum = 0
    for (let i = 0; i < totalDaysInMonth; i++) {
      profCum += profile[i] || 0
      cumulativeProfile.push(profCum)
    }

    const totalProfile = profCum
    if (totalProfile <= 0) {
      // Fallback: daily average
      const dailyAvg = totalActualExpense / actualDaysCount
      let runningTotal = totalActualExpense
      for (let i = todayIdx + 1; i < totalDaysInMonth; i++) {
        runningTotal += dailyAvg
        trendByDay[i] = runningTotal
      }
      projectedTotal = trendByDay[totalDaysInMonth - 1] || totalActualExpense
    } else {
      // Normalize the curve
      const normalizedCurve = cumulativeProfile.map(v => v / totalProfile)
      const curveAtToday = normalizedCurve[todayIdx] || 0

      let estimatedTotal: number

      if (curveAtToday < 0.05) {
        // Too early in the month for reliable curve estimation — fallback to daily avg
        const dailyAvg = totalActualExpense / actualDaysCount
        const dowProfile = historicalProfile.dayOfWeekProfile
        let runningTotal = totalActualExpense
        for (let i = todayIdx + 1; i < totalDaysInMonth; i++) {
          const dow = getDayOfWeek(days[i])
          runningTotal += dailyAvg * dowProfile[dow]
          trendByDay[i] = runningTotal
        }
        projectedTotal = trendByDay[totalDaysInMonth - 1] || totalActualExpense
      } else {
        // Estimate total: actual / curve_fraction_at_today
        estimatedTotal = totalActualExpense / curveAtToday

        // Level 3 additions: seasonality adjustment
        if (predictionLevel === 3 && monthCount >= 12) {
          const monthlyTotals = historicalProfile.monthlyTotals
          const overallMonthlyAvg = monthlyTotals.reduce((s, m) => s + m.total, 0) / monthlyTotals.length
          const currentMonthTotals = monthlyTotals.filter(m => {
            const monthIdx = parseInt(m.yearMonth.split('-')[1]) - 1
            return monthIdx === currentMonth
          })
          if (currentMonthTotals.length > 0 && overallMonthlyAvg > 0) {
            const currentMonthAvg = currentMonthTotals.reduce((s, m) => s + m.total, 0) / currentMonthTotals.length
            const seasonalityRatio = currentMonthAvg / overallMonthlyAvg
            estimatedTotal *= seasonalityRatio
          }
        }

        // Build future trend from actual today, using the curve shape
        // For future day i: trend = actualToday + estimatedTotal * (curve[i] - curve[todayIdx])
        // This ensures the trend starts exactly at the actual value today
        const curveRemaining = 1.0 - curveAtToday
        const estimatedRemaining = estimatedTotal - totalActualExpense

        if (predictionLevel === 3) {
          // Level 3: blend curve with day-of-week for future days
          const dowProfile = historicalProfile.dayOfWeekProfile
          let runningTotal = totalActualExpense

          for (let i = todayIdx + 1; i < totalDaysInMonth; i++) {
            // Base increment from curve
            const curveIncrement = estimatedTotal * (normalizedCurve[i] - normalizedCurve[i - 1])
            // Day-of-week adjustment
            const dow = getDayOfWeek(days[i])
            const dowAdj = dowProfile[dow]
            // 70% curve + 30% dow adjustment
            const adjustedIncrement = curveIncrement * (0.7 + 0.3 * dowAdj)
            runningTotal += adjustedIncrement
            trendByDay[i] = runningTotal
          }

          projectedTotal = trendByDay[totalDaysInMonth - 1] || totalActualExpense
        } else {
          // Level 2: pure curve projection from actual today value
          for (let i = todayIdx + 1; i < totalDaysInMonth; i++) {
            const curveFractionFromToday = (normalizedCurve[i] - curveAtToday) / curveRemaining
            trendByDay[i] = totalActualExpense + estimatedRemaining * curveFractionFromToday
          }

          projectedTotal = totalActualExpense + estimatedRemaining
        }
      }
    }
  }

  // Build the chart data
  const data = days.map((day, i) => {
    const isFuture = day > today
    return {
      date: day,
      label: day.slice(5),
      actual: isFuture ? null : (cumulativeByDay.get(day) || 0) / 100,
      trend: trendByDay[i] != null ? trendByDay[i] / 100 : null,
    }
  })

  return { data, projectedTotal: Math.round(projectedTotal), predictionLevel }
}

function buildIncomeChart(dailyData: DailyData[], startDate: string, endDate: string) {
  const days = daysInRange(startDate, endDate)
  const map = new Map(dailyData.map(d => [d.date, d.income]))
  const today = fmt(new Date())
  
  // Find the last day we have actual data for (up to today)
  const lastActualDay = days.filter(d => d <= today).pop() || today
  
  let cumulative = 0
  return days.map(day => {
    cumulative += (map.get(day) || 0)
    // Only show income data up to today (lastActualDay)
    if (day > lastActualDay) {
      return { label: day.slice(5), income: null }
    }
    return { label: day.slice(5), income: cumulative / 100 }
  })
}

function buildBalanceChart(dailyData: DailyData[], startDate: string, endDate: string) {
  const days = daysInRange(startDate, endDate)
  const incMap = new Map(dailyData.map(d => [d.date, d.income]))
  const expMap = new Map(dailyData.map(d => [d.date, d.expense]))
  const today = fmt(new Date())
  
  // Find the last day we have actual data for (up to today)
  const lastActualDay = days.filter(d => d <= today).pop() || today
  
  let balance = 0
  return days.map(day => {
    balance += (incMap.get(day) || 0) - (expMap.get(day) || 0)
    // Only show balance data up to today (lastActualDay)
    if (day > lastActualDay) {
      return { label: day.slice(5), balance: null }
    }
    return { label: day.slice(5), balance: balance / 100 }
  })
}

// ─── Custom tooltip ──────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, color }: TooltipContentProps<number, string> & { color: string }) {
  if (!active || !payload?.length) return null
  const rawValue = payload[0]?.value
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, padding: '6px 10px', fontSize: 12, color }}>
      <div style={{ color: '#888', marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{Number.isFinite(value) ? formatCurrency(Math.round(value * 100), 'CLP') : ''}</div>
    </div>
  )
}

// ─── Calendar component ──────────────────────────────────────────────────────

function MiniCalendar({ startDate, endDate, onSelect }: {
  startDate: string; endDate: string
  onSelect: (s: string, e: string) => void
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(startDate + 'T00:00:00')
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [selecting, setSelecting] = useState<string | null>(null)

  const { year, month } = viewMonth
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const offset = firstDay === 0 ? 6 : firstDay - 1

  const cells: (number | null)[] = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let i = 1; i <= daysInMonth; i++) cells.push(i)

  const handleDayClick = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (!selecting) {
      setSelecting(dateStr)
    } else {
      const [s, e] = selecting < dateStr ? [selecting, dateStr] : [dateStr, selecting]
      setSelecting(null)
      onSelect(s, e)
    }
  }

  const isInRange = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (selecting) return dateStr === selecting
    return dateStr >= startDate && dateStr <= endDate
  }

  const monthLabel = new Date(year, month).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <button onClick={() => setViewMonth(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 })}
          style={{ background: 'none', border: 'none', color: '#e5e5e5', fontSize: 18, cursor: 'pointer', padding: '4px 8px' }}>‹</button>
        <span style={{ fontSize: 14, color: '#e5e5e5', fontWeight: 600, textTransform: 'capitalize' }}>{monthLabel}</span>
        <button onClick={() => setViewMonth(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 })}
          style={{ background: 'none', border: 'none', color: '#e5e5e5', fontSize: 18, cursor: 'pointer', padding: '4px 8px' }}>›</button>
      </div>
      {selecting && <div style={{ fontSize: 11, color: '#f59e0b', textAlign: 'center', marginBottom: 6 }}>Selecciona fecha fin</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, textAlign: 'center' }}>
        {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => (
          <div key={d} style={{ fontSize: 11, color: '#555', padding: 4 }}>{d}</div>
        ))}
        {cells.map((day, i) => day ? (
          <button key={i} onClick={() => handleDayClick(day)}
            style={{
              background: isInRange(day) ? '#22c55e33' : 'none',
              border: isInRange(day) ? '1px solid #22c55e' : '1px solid transparent',
              borderRadius: 6, color: '#d4d4d8', fontSize: 13, padding: '6px 0', cursor: 'pointer',
            }}>{day}</button>
        ) : <div key={i} />)}
      </div>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface ReportsPageProps {
  initialData: ReportData
  initialStartDate: string
  initialEndDate: string
}

type CategorySpendingItem = ReportData['categorySpending'][number]

export function ReportsPage({ initialData, initialStartDate, initialEndDate }: ReportsPageProps) {
  const [dateRange, setDateRange] = useState<[string, string]>([initialStartDate, initialEndDate])
  const [activePreset, setActivePreset] = useState('Este mes')
  const [showPicker, setShowPicker] = useState(false)
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [data, setData] = useState<ReportData | null>(initialData)
  const [loading, setLoading] = useState(false)
  const [historicalProfile, setHistoricalProfile] = useState<HistoricalExpenseProfile | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<CategorySpendingItem | null>(null)
  const [categoryMovements, setCategoryMovements] = useState<ReportCategoryMovement[]>([])
  const [categoryMovementsLoading, setCategoryMovementsLoading] = useState(false)
  const [categoryMovementsError, setCategoryMovementsError] = useState<string | null>(null)
  const historicalFetched = useRef(false)

  // Track whether we're still on the initial server-prefetched state
  const isInitial = useRef(true)

  const isCurrentMonth = activePreset === 'Este mes'

  // Fetch historical profile once when needed
  useEffect(() => {
    if (isCurrentMonth && !historicalFetched.current) {
      historicalFetched.current = true
      getHistoricalExpenseProfile().then(setHistoricalProfile).catch(console.error)
    }
  }, [isCurrentMonth])

  useEffect(() => {
    // Skip fetch on mount — we already have server-prefetched data
    if (isInitial.current) {
      isInitial.current = false
      return
    }

    let cancelled = false

    const loadData = async () => {
      setLoading(true)
      try {
        const nextData = await getReportData(dateRange[0], dateRange[1], categoryId || undefined, accountId || undefined)
        if (cancelled) return
        setData(nextData)
      } catch (error) {
        if (cancelled) return
        console.error(error)
      } finally {
        if (cancelled) return
        setLoading(false)
      }
    }

    void loadData()

    return () => {
      cancelled = true
    }
  }, [dateRange, categoryId, accountId])

  const closeCategorySheet = useCallback(() => {
    setSelectedCategory(null)
    setCategoryMovements([])
    setCategoryMovementsError(null)
    setCategoryMovementsLoading(false)
  }, [])

  useEffect(() => {
    if (!selectedCategory) return

    let cancelled = false

    const loadCategoryMovements = async () => {
      setCategoryMovements([])
      setCategoryMovementsError(null)
      setCategoryMovementsLoading(true)

      try {
        const movements = await getReportCategoryMovements(dateRange[0], dateRange[1], selectedCategory.id, accountId || undefined)
        if (cancelled) return
        setCategoryMovements(movements)
      } catch (error) {
        if (cancelled) return
        console.error(error)
        setCategoryMovementsError('No se pudieron cargar los movimientos')
      } finally {
        if (cancelled) return
        setCategoryMovementsLoading(false)
      }
    }

    void loadCategoryMovements()

    return () => {
      cancelled = true
    }
  }, [selectedCategory, dateRange, accountId])

  useEffect(() => {
    if (!selectedCategory) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeCategorySheet()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedCategory, closeCategorySheet])

  const handlePreset = (p: Preset) => {
    const [s, e] = p.getRange()
    setDateRange([fmt(s), fmt(e)])
    setActivePreset(p.label)
    setShowPicker(false)
  }

  const handleCustomDate = (s: string, e: string) => {
    setDateRange([s, e])
    setActivePreset('')
    setShowPicker(false)
  }

  const expenseChart = useMemo(() =>
    data ? buildExpenseChart(data.dailyData, dateRange[0], dateRange[1], historicalProfile, isCurrentMonth) : { data: [], projectedTotal: 0, predictionLevel: 0 },
    [data, dateRange, historicalProfile, isCurrentMonth])
  const incomeChart = useMemo(() =>
    data ? buildIncomeChart(data.dailyData, dateRange[0], dateRange[1]) : [],
    [data, dateRange])
  const balanceChart = useMemo(() =>
    data ? buildBalanceChart(data.dailyData, dateRange[0], dateRange[1]) : [],
    [data, dateRange])
  const categorySheetTotal = useMemo(() => {
    const loadedTotal = categoryMovements.reduce((sum, movement) => sum + movement.amount, 0)
    return loadedTotal || selectedCategory?.total || 0
  }, [categoryMovements, selectedCategory])
  const categorySheetPeriodLabel = useMemo(() => {
    const startLabel = formatShortDate(dateRange[0])
    const endLabel = formatShortDate(dateRange[1])
    return dateRange[0] === dateRange[1] ? startLabel : `${startLabel} - ${endLabel}`
  }, [dateRange])
  const categorySheetCount = useMemo(() => {
    if (categoryMovementsLoading || categoryMovementsError) {
      return selectedCategory?.count || 0
    }
    return categoryMovements.length
  }, [categoryMovements.length, categoryMovementsLoading, categoryMovementsError, selectedCategory])

  const dateLabel = activePreset || `${dateRange[0].slice(5)} → ${dateRange[1].slice(5)}`

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#1a1a1a', borderRadius: 14, padding: 16,
    border: '1px solid #2a2a2a', marginBottom: 16,
  }

  const selectStyle: React.CSSProperties = {
    backgroundColor: '#1a1a1a', color: '#d4d4d8', border: '1px solid #2a2a2a',
    borderRadius: 10, padding: '8px 12px', fontSize: 13, flex: 1,
    appearance: 'none', WebkitAppearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
  }

  return (
    <>
      <header style={{
        backgroundColor: '#111111', borderBottom: '1px solid #1e1e1e',
        padding: '12px 16px', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: 540, margin: '0 auto', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#f5f5f5' }}>Reportes</span>
        </div>
      </header>

      <main style={{ maxWidth: 540, margin: '0 auto', padding: '16px 16px 96px' }}>
        {/* Date Selector */}
        <button onClick={() => setShowPicker(!showPicker)} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          width: '100%', background: 'none', border: '1px solid #2a2a2a', borderRadius: 10,
          padding: '10px 14px', marginBottom: 12, cursor: 'pointer', color: '#e5e5e5', fontSize: 14,
        }}>
          📅 <span style={{ fontWeight: 600 }}>{dateLabel}</span>
          <span style={{ fontSize: 10, marginLeft: 4 }}>{showPicker ? '▲' : '▼'}</span>
        </button>

        {showPicker && (
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            {/* Presets */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {PRESETS.map(p => (
                <button key={p.label} onClick={() => handlePreset(p)} style={{
                  padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                  border: activePreset === p.label ? '1px solid #22c55e' : '1px solid #333',
                  background: activePreset === p.label ? '#22c55e22' : '#111',
                  color: activePreset === p.label ? '#22c55e' : '#a1a1aa',
                }}>{p.label}</button>
              ))}
            </div>
            <MiniCalendar startDate={dateRange[0]} endDate={dateRange[1]} onSelect={handleCustomDate} />
          </div>
        )}

        {/* Category & Account Filters */}
        {data && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={selectStyle}>
              <option value="">Todas las categorías</option>
              {data.categories.map(c => (
                <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
              ))}
            </select>
            <select value={accountId} onChange={e => setAccountId(e.target.value)} style={selectStyle}>
              <option value="">Todas las cuentas</option>
              {data.accounts.map(a => (
                <option key={a.id} value={a.id}>{a.emoji || '💳'} {a.bankName} •{a.lastFour}</option>
              ))}
            </select>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>Cargando...</div>
        ) : data && data.movementCount === 0 ? (
          /* Consolidated empty state when no movements exist */
          <div style={{
            background: 'linear-gradient(135deg, #18181b 0%, #1a2e1a 100%)',
            borderRadius: 20, padding: '48px 24px', textAlign: 'center',
            border: '1px solid #2a3a2a', marginTop: 8,
          }}>
            <span style={{ fontSize: 56, display: 'block', marginBottom: 16 }}>📊</span>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#f5f5f5', marginBottom: 8 }}>
              Sin datos en este período
            </div>
            <div style={{ fontSize: 14, color: '#a1a1aa', marginBottom: 28, lineHeight: 1.6, maxWidth: 280, margin: '0 auto 28px' }}>
              Agrega movimientos para ver tus reportes de gastos, ingresos y balance aquí.
            </div>
            <a
              href="/add"
              style={{
                display: 'inline-block',
                padding: '14px 28px', borderRadius: 14, border: 'none',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(34,197,94,0.3)',
                textDecoration: 'none',
              }}
            >
              Agregar Movimiento →
            </a>
          </div>
        ) : data && (
          <>
            {/* Summary Cards */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              {[
                { label: 'Ingresos', value: data.totalIncome, color: '#4ade80' },
                { label: 'Gastos', value: data.totalExpense, color: '#f87171' },
                { label: 'Neto', value: data.totalIncome - data.totalExpense, color: data.totalIncome - data.totalExpense >= 0 ? '#4ade80' : '#f87171' },
              ].map(c => (
                <div key={c.label} style={{
                  flex: 1, backgroundColor: '#1a1a1a', borderRadius: 14,
                  padding: '14px 8px', border: '1px solid #2a2a2a', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 11, color: '#a1a1aa', marginBottom: 4 }}>{c.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: c.color }}>{formatCurrency(Math.abs(c.value), 'CLP')}</div>
                </div>
              ))}
            </div>

            {/* Chart 1: Expenses */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: '#e5e5e5', margin: 0 }}>📉 Gastos</h2>
                {expenseChart.projectedTotal > 0 && (
                  <span style={{ fontSize: 12, color: '#f59e0b' }}>
                    Gasto esperado: {formatCurrency(Math.round(expenseChart.projectedTotal), 'CLP')}
                  </span>
                )}
              </div>
              {expenseChart.data.every(d => !d.actual) ? (
                <div style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 0', fontSize: 13 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📉</div>
                  Sin gastos en este período
                </div>
              ) : (
                <>
                  <div style={{ width: '100%', height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={expenseChart.data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#555' }} tickLine={false} axisLine={false}
                          interval={Math.max(0, Math.floor(expenseChart.data.length / 6) - 1)} />
                        <YAxis tick={{ fontSize: 10, fill: '#555' }} tickLine={false} axisLine={false} width={45} domain={[0, 'auto']}
                          tickFormatter={(v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                        <Tooltip content={(props: any) => <ChartTooltip {...props} color="#ef4444" />} />
                        <Line type="monotone" dataKey="actual" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls={false} />
                        <Line type="monotone" dataKey="trend" stroke="#eab308" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                </>
              )}
            </div>

            {/* Chart 2: Income */}
            <div style={cardStyle}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: '#e5e5e5', margin: '0 0 12px' }}>📈 Ingresos</h2>
              {incomeChart.every(d => d.income === 0 || d.income === null) ? (
                <div style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 0', fontSize: 13 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📈</div>
                  Sin ingresos en este período
                </div>
              ) : (
                <div style={{ width: '100%', height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={incomeChart} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#555' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: '#555' }} tickLine={false} axisLine={false} width={45}
                        tickFormatter={(v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                      <Tooltip content={(props: any) => <ChartTooltip {...props} color="#22c55e" />} />
                      <Line type="monotone" dataKey="income" stroke="#22c55e" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Chart 3: Balance */}
            <div style={cardStyle}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: '#e5e5e5', margin: '0 0 12px' }}>💰 Balance</h2>
              {balanceChart.every(d => d.balance === 0 || d.balance === null) ? (
                <div style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 0', fontSize: 13 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>💰</div>
                  Sin movimientos en este período
                </div>
              ) : (
                <div style={{ width: '100%', height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={balanceChart} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#555' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: '#555' }} tickLine={false} axisLine={false} width={45}
                        tickFormatter={(v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                      <Tooltip content={(props: any) => <ChartTooltip {...props} color="#e5e5e5" />} />
                      <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="balance" stroke="#e5e5e5" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Category Spending */}
            <div style={cardStyle}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: '#e5e5e5', margin: '0 0 14px' }}>Gastos por Categoría</h2>
              {data.categorySpending.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#9ca3af', padding: '20px 0', fontSize: 13 }}>Sin gastos en este período</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {data.categorySpending.map((cat, i) => {
                    const max = data.categorySpending[0]?.total || 1
                    return (
                      <button
                        key={`${cat.id || 'uncategorized'}-${cat.name}-${i}`}
                        type="button"
                        onClick={() => setSelectedCategory(cat)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <span style={{ fontSize: 16 }}>{cat.emoji}</span>
                            <span style={{ fontSize: 14, color: '#d4d4d8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cat.name}</span>
                            <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>({cat.count})</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: '#f87171' }}>{formatCurrency(cat.total, 'CLP')}</span>
                            <span style={{ fontSize: 16, color: '#71717a' }}>›</span>
                          </div>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, backgroundColor: '#27272a', overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 3, backgroundColor: '#ef4444', width: `${(cat.total / max) * 100}%`, transition: 'width 0.3s ease' }} />
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Movement Count */}
            <div style={{
              ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 14, color: '#a1a1aa' }}>Total movimientos</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: '#e5e5e5' }}>{data.movementCount}</span>
            </div>
          </>
        )}
      </main>

      {selectedCategory && (
        <div
          onClick={closeCategorySheet}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.78)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            zIndex: 60,
            padding: '16px 16px calc(16px + env(safe-area-inset-bottom, 0px))',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 540,
              maxHeight: '82vh',
              background: 'linear-gradient(180deg, #18181b 0%, #111111 100%)',
              border: '1px solid #2a2a2a',
              borderRadius: 24,
              boxShadow: '0 -16px 40px rgba(0,0,0,0.45)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ padding: '10px 18px 0' }}>
              <div style={{ width: 42, height: 4, borderRadius: 999, backgroundColor: '#3f3f46', margin: '0 auto 12px' }} />
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
              padding: '0 18px 16px',
              borderBottom: '1px solid #27272a',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 6 }}>Movimientos de la categoría</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 24 }}>{selectedCategory.emoji}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#f5f5f5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {selectedCategory.name}
                    </div>
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>
                      {categorySheetCount} movimiento{categorySheetCount === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={closeCategorySheet}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  border: '1px solid #2a2a2a',
                  backgroundColor: '#18181b',
                  color: '#a1a1aa',
                  fontSize: 18,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '14px 18px',
              borderBottom: '1px solid #27272a',
              backgroundColor: '#121212',
            }}>
              <div>
                <div style={{ fontSize: 11, color: '#71717a', marginBottom: 4 }}>Período</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#d4d4d8' }}>{categorySheetPeriodLabel}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#71717a', marginBottom: 4 }}>Total</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#f87171' }}>{formatCurrency(categorySheetTotal, 'CLP')}</div>
              </div>
            </div>

            <div style={{ padding: '0 18px', overflowY: 'auto' }}>
              {categoryMovementsLoading ? (
                <div style={{ padding: '36px 0', textAlign: 'center', color: '#a1a1aa', fontSize: 13 }}>
                  Cargando movimientos...
                </div>
              ) : categoryMovementsError ? (
                <div style={{ padding: '24px 0' }}>
                  <div style={{
                    backgroundColor: '#450a0a',
                    border: '1px solid #7f1d1d',
                    borderRadius: 12,
                    padding: '12px 14px',
                    fontSize: 13,
                    color: '#fca5a5',
                    marginBottom: 12,
                  }}>
                    {categoryMovementsError}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCategory({ ...selectedCategory })}
                    style={{
                      width: '100%',
                      height: 42,
                      borderRadius: 12,
                      border: '1px solid #2a2a2a',
                      backgroundColor: '#18181b',
                      color: '#e5e5e5',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Reintentar
                  </button>
                </div>
              ) : categoryMovements.length === 0 ? (
                <div style={{ padding: '36px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                  No hay movimientos para esta categoría en el período seleccionado
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {categoryMovements.map((movement, index) => (
                    <div
                      key={movement.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '14px 0',
                        borderBottom: index === categoryMovements.length - 1 ? 'none' : '1px solid #1f1f23',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: '#71717a', marginBottom: 4 }}>
                          {formatShortDate(movement.date)}{movement.time ? ` · ${movement.time}` : ''}
                        </div>
                        <div style={{
                          fontSize: 15,
                          fontWeight: 500,
                          color: '#e5e5e5',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          {movement.name}
                        </div>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#f87171', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        -{formatCurrency(movement.amount, 'CLP')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: '16px 18px 18px', borderTop: '1px solid #27272a' }}>
              <button
                type="button"
                onClick={closeCategorySheet}
                style={{
                  width: '100%',
                  height: 46,
                  borderRadius: 14,
                  border: '1px solid #2a2a2a',
                  backgroundColor: '#18181b',
                  color: '#e5e5e5',
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
