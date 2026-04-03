'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { formatCurrency, today as todayInTimezone } from '@/lib/utils'
import { getReportData, type ReportData, type DailyData } from '@/lib/actions/reports'
import { getReportCategoryMovements, type ReportCategoryMovement } from '@/lib/actions/movements'
import {
  type TooltipContentProps,
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ─── Date helpers ────────────────────────────────────────────────────────────

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function fmt(d: Date) {
  return `${d.getFullYear()}-${padDatePart(d.getMonth() + 1)}-${padDatePart(d.getDate())}`
}

function parseDate(dateStr: string) {
  return new Date(`${dateStr}T12:00:00`)
}

function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function addMonths(date: Date, amount: number) {
  const targetMonth = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12)
  const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 12).getDate()
  return new Date(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(date.getDate(), lastDay), 12)
}

function startOfWeek(d: Date) {
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1 // Monday = start
  return addDays(d, -diff)
}

function endOfWeek(d: Date) {
  return addDays(startOfWeek(d), 6)
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 12)
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)
}

function startOfYear(d: Date) {
  return new Date(d.getFullYear(), 0, 1, 12)
}

function endOfYear(d: Date) {
  return new Date(d.getFullYear(), 11, 31, 12)
}

type PresetKey = 'year' | 'hundredDays' | 'month' | 'week'

type PresetDefinition = {
  key: PresetKey
  label: string
  getRange: (anchor: Date) => [Date, Date]
  shiftAnchor: (anchor: Date, direction: -1 | 1) => Date
}

type PeriodSelection =
  | { kind: 'preset'; presetKey: PresetKey; anchorDate: string }
  | { kind: 'custom'; range: [string, string] }

const PRESETS: PresetDefinition[] = [
  {
    key: 'year',
    label: 'Año',
    getRange: anchor => [startOfYear(anchor), endOfYear(anchor)],
    shiftAnchor: (anchor, direction) => addMonths(anchor, direction * 12),
  },
  {
    key: 'hundredDays',
    label: '100 días',
    getRange: anchor => [addDays(anchor, -99), anchor],
    shiftAnchor: (anchor, direction) => addDays(anchor, direction * 100),
  },
  {
    key: 'month',
    label: 'Mes',
    getRange: anchor => [startOfMonth(anchor), endOfMonth(anchor)],
    shiftAnchor: (anchor, direction) => addMonths(anchor, direction),
  },
  {
    key: 'week',
    label: 'Semana',
    getRange: anchor => [startOfWeek(anchor), endOfWeek(anchor)],
    shiftAnchor: (anchor, direction) => addDays(anchor, direction * 7),
  },
]

function getPresetDefinition(key: PresetKey) {
  const preset = PRESETS.find(item => item.key === key)
  if (!preset) {
    throw new Error(`Unknown preset: ${key}`)
  }
  return preset
}

function getPresetRange(key: PresetKey, anchorDate: string): [string, string] {
  const [start, end] = getPresetDefinition(key).getRange(parseDate(anchorDate))
  return [fmt(start), fmt(end)]
}

function inferInitialPeriodSelection(startDate: string, endDate: string): PeriodSelection {
  const today = todayInTimezone()

  for (const preset of PRESETS) {
    const [presetStart, presetEnd] = getPresetRange(preset.key, today)
    if (presetStart === startDate && presetEnd === endDate) {
      return { kind: 'preset', presetKey: preset.key, anchorDate: today }
    }
  }

  return { kind: 'custom', range: [startDate, endDate] }
}

function formatRangeSummary(startDate: string, endDate: string) {
  const start = parseDate(startDate)
  const end = parseDate(endDate)
  const sameYear = start.getFullYear() === end.getFullYear()
  const startOptions: Intl.DateTimeFormatOptions = sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' }
  const startLabel = start.toLocaleDateString('es-CL', startOptions)
  const endLabel = end.toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return startDate === endDate ? endLabel : `${startLabel} - ${endLabel}`
}

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

function buildExpenseChart(
  dailyData: DailyData[],
  startDate: string,
  endDate: string
): { data: { date: string; label: string; actual: number | null; trend: number | null }[]; trendTotal: number | null } {
  const days = daysInRange(startDate, endDate)
  const map = new Map(dailyData.map(d => [d.date, d.expense]))
  const today = todayInTimezone()
  const observableEnd = endDate < today ? endDate : today

  // Only days inside the range up to the observable end contribute to actuals and the average line.
  let cumulative = 0
  let totalActualExpense = 0
  let actualDaysCount = 0
  const cumulativeByDay = new Map<string, number>()

  for (const day of days) {
    if (day > observableEnd) break
    const val = map.get(day) || 0
    cumulative += val
    cumulativeByDay.set(day, cumulative)
    totalActualExpense = cumulative
    actualDaysCount++
  }

  if (actualDaysCount <= 0) {
    const data = days.map(day => {
      return {
        date: day,
        label: day.slice(5),
        actual: null,
        trend: null,
      }
    })
    return { data, trendTotal: null }
  }

  if (totalActualExpense <= 0) {
    const data = days.map(day => {
      const isFuture = day > observableEnd
      return {
        date: day,
        label: day.slice(5),
        actual: isFuture ? null : 0,
        trend: null,
      }
    })
    return { data, trendTotal: null }
  }

  const averageDailyExpense = totalActualExpense / actualDaysCount
  const trendByDay = days.map((_, index) => averageDailyExpense * (index + 1))
  const trendTotal = trendByDay[days.length - 1] ?? totalActualExpense

  const data = days.map((day, i) => {
    const isFuture = day > observableEnd
    return {
      date: day,
      label: day.slice(5),
      actual: isFuture ? null : (cumulativeByDay.get(day) || 0) / 100,
      trend: trendByDay[i] != null ? trendByDay[i] / 100 : null,
    }
  })

  return { data, trendTotal: Math.round(trendTotal) }
}

function buildIncomeChart(dailyData: DailyData[], startDate: string, endDate: string) {
  const days = daysInRange(startDate, endDate)
  const map = new Map(dailyData.map(d => [d.date, d.income]))
  const today = todayInTimezone()
  
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
  const today = todayInTimezone()
  
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

function MiniCalendar({ startDate, endDate, focusDate, onSelect }: {
  startDate: string
  endDate: string
  focusDate: string
  onSelect: (s: string, e: string) => void
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = parseDate(focusDate)
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
    const dateStr = `${year}-${padDatePart(month + 1)}-${padDatePart(day)}`
    if (!selecting) {
      setSelecting(dateStr)
    } else {
      const [s, e] = selecting < dateStr ? [selecting, dateStr] : [dateStr, selecting]
      setSelecting(null)
      onSelect(s, e)
    }
  }

  const getDayState = (day: number) => {
    const dateStr = `${year}-${padDatePart(month + 1)}-${padDatePart(day)}`
    const pendingSelection = selecting === dateStr
    const isRangeStart = !selecting && dateStr === startDate
    const isRangeEnd = !selecting && dateStr === endDate
    const isInRange = selecting ? pendingSelection : dateStr >= startDate && dateStr <= endDate

    return {
      dateStr,
      pendingSelection,
      isRangeStart,
      isRangeEnd,
      isInRange,
    }
  }

  const monthLabel = new Date(year, month).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })

  return (
    <div data-testid="reports-calendar">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <button
          type="button"
          aria-label="Mes anterior"
          onClick={() => setViewMonth(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 })}
          style={{ background: 'none', border: 'none', color: '#e5e5e5', fontSize: 18, cursor: 'pointer', padding: '4px 8px' }}>‹</button>
        <span style={{ fontSize: 14, color: '#e5e5e5', fontWeight: 600, textTransform: 'capitalize' }}>{monthLabel}</span>
        <button
          type="button"
          aria-label="Mes siguiente"
          onClick={() => setViewMonth(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 })}
          style={{ background: 'none', border: 'none', color: '#e5e5e5', fontSize: 18, cursor: 'pointer', padding: '4px 8px' }}>›</button>
      </div>
      {selecting && <div style={{ fontSize: 11, color: '#f59e0b', textAlign: 'center', marginBottom: 6 }}>Selecciona fecha fin</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, textAlign: 'center' }}>
        {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => (
          <div key={d} style={{ fontSize: 11, color: '#555', padding: 4 }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} />

          const dayState = getDayState(day)
          const isSelectedEdge = dayState.pendingSelection || dayState.isRangeStart || dayState.isRangeEnd

          return (
            <button
              key={i}
              type="button"
              data-testid={`reports-calendar-day-${dayState.dateStr}`}
              data-in-range={dayState.isInRange ? 'true' : 'false'}
              data-range-start={dayState.isRangeStart ? 'true' : 'false'}
              data-range-end={dayState.isRangeEnd ? 'true' : 'false'}
              aria-pressed={dayState.isInRange}
              onClick={() => handleDayClick(day)}
              style={{
                background: isSelectedEdge ? '#22c55e' : dayState.isInRange ? '#22c55e22' : 'none',
                border: isSelectedEdge ? '1px solid #22c55e' : dayState.isInRange ? '1px solid #22c55e66' : '1px solid transparent',
                borderRadius: 6,
                color: isSelectedEdge ? '#052e16' : '#d4d4d8',
                fontSize: 13,
                fontWeight: isSelectedEdge ? 700 : 500,
                padding: '6px 0',
                cursor: 'pointer',
              }}
            >
              {day}
            </button>
          )
        })}
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
  const [periodSelection, setPeriodSelection] = useState<PeriodSelection>(() =>
    inferInitialPeriodSelection(initialStartDate, initialEndDate)
  )
  const [showPicker, setShowPicker] = useState(false)
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [data, setData] = useState<ReportData | null>(initialData)
  const [loading, setLoading] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<CategorySpendingItem | null>(null)
  const [categoryMovements, setCategoryMovements] = useState<ReportCategoryMovement[]>([])
  const [categoryMovementsLoading, setCategoryMovementsLoading] = useState(false)
  const [categoryMovementsError, setCategoryMovementsError] = useState<string | null>(null)

  const dateRange = useMemo<[string, string]>(() => {
    if (periodSelection.kind === 'preset') {
      return getPresetRange(periodSelection.presetKey, periodSelection.anchorDate)
    }

    return periodSelection.range
  }, [periodSelection])
  const [startDate, endDate] = dateRange
  const activePreset = periodSelection.kind === 'preset' ? getPresetDefinition(periodSelection.presetKey) : null
  const presetAnchorDate = periodSelection.kind === 'preset' ? periodSelection.anchorDate : null
  const canShiftPeriod = periodSelection.kind === 'preset'
  const calendarFocusDate = periodSelection.kind === 'preset' ? periodSelection.anchorDate : endDate
  const controlCopy = useMemo(() => {
    if (!activePreset || !presetAnchorDate) {
      return {
        title: 'Personalizado',
        subtitle: formatRangeSummary(startDate, endDate),
        capitalizeSubtitle: false,
      }
    }

    if (activePreset.key === 'year') {
      return {
        title: activePreset.label,
        subtitle: String(parseDate(presetAnchorDate).getFullYear()),
        capitalizeSubtitle: false,
      }
    }

    if (activePreset.key === 'month') {
      return {
        title: activePreset.label,
        subtitle: parseDate(presetAnchorDate).toLocaleDateString('es-CL', {
          month: 'long',
          year: 'numeric',
        }),
        capitalizeSubtitle: true,
      }
    }

    return {
      title: activePreset.label,
      subtitle: formatRangeSummary(startDate, endDate),
      capitalizeSubtitle: false,
    }
  }, [activePreset, presetAnchorDate, startDate, endDate])

  // Track whether we're still on the initial server-prefetched state
  const isInitial = useRef(true)

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
        const nextData = await getReportData(startDate, endDate, categoryId || undefined, accountId || undefined)
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
  }, [startDate, endDate, categoryId, accountId])

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
        const movements = await getReportCategoryMovements(startDate, endDate, selectedCategory.id, accountId || undefined)
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
  }, [selectedCategory, startDate, endDate, accountId])

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

  const handlePreset = (presetKey: PresetKey) => {
    setPeriodSelection({
      kind: 'preset',
      presetKey,
      anchorDate: todayInTimezone(),
    })
  }

  const handleCustomDate = (s: string, e: string) => {
    setPeriodSelection({ kind: 'custom', range: [s, e] })
    setShowPicker(false)
  }

  const shiftPeriod = (direction: -1 | 1) => {
    setPeriodSelection(current => {
      if (current.kind !== 'preset') {
        return current
      }

      const nextAnchor = getPresetDefinition(current.presetKey).shiftAnchor(parseDate(current.anchorDate), direction)

      return {
        ...current,
        anchorDate: fmt(nextAnchor),
      }
    })
  }

  const expenseChart = useMemo(() =>
    data ? buildExpenseChart(data.dailyData, startDate, endDate) : { data: [], trendTotal: null },
    [data, startDate, endDate])
  const incomeChart = useMemo(() =>
    data ? buildIncomeChart(data.dailyData, startDate, endDate) : [],
    [data, startDate, endDate])
  const balanceChart = useMemo(() =>
    data ? buildBalanceChart(data.dailyData, startDate, endDate) : [],
    [data, startDate, endDate])
  const categorySheetTotal = useMemo(() => {
    const loadedTotal = categoryMovements.reduce((sum, movement) => sum + movement.amount, 0)
    return loadedTotal || selectedCategory?.total || 0
  }, [categoryMovements, selectedCategory])
  const categorySheetPeriodLabel = useMemo(() => {
    const startLabel = formatShortDate(startDate)
    const endLabel = formatShortDate(endDate)
    return startDate === endDate ? startLabel : `${startLabel} - ${endLabel}`
  }, [startDate, endDate])
  const categorySheetCount = useMemo(() => {
    if (categoryMovementsLoading || categoryMovementsError) {
      return selectedCategory?.count || 0
    }
    return categoryMovements.length
  }, [categoryMovements.length, categoryMovementsLoading, categoryMovementsError, selectedCategory])

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
        <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr) 44px', gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            data-testid="reports-period-prev"
            aria-label="Período anterior"
            disabled={!canShiftPeriod}
            onClick={() => shiftPeriod(-1)}
            style={{
              background: canShiftPeriod ? '#111' : '#161616',
              border: '1px solid #2a2a2a',
              borderRadius: 10,
              color: canShiftPeriod ? '#e5e5e5' : '#52525b',
              fontSize: 18,
              cursor: canShiftPeriod ? 'pointer' : 'not-allowed',
            }}
          >
            ‹
          </button>

          <button
            type="button"
            data-testid="reports-period-trigger"
            data-period-kind={periodSelection.kind}
            data-period-preset={activePreset?.key ?? 'custom'}
            data-period-start={startDate}
            data-period-end={endDate}
            aria-label={`${controlCopy.title}: ${controlCopy.subtitle}`}
            onClick={() => setShowPicker(!showPicker)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              minWidth: 0,
              width: '100%',
              background: 'none',
              border: '1px solid #2a2a2a',
              borderRadius: 10,
              padding: '10px 14px',
              cursor: 'pointer',
              color: '#e5e5e5',
              fontSize: 14,
            }}
          >
            <span style={{ fontSize: 18, flexShrink: 0 }}>📅</span>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.2 }}>{controlCopy.title}</span>
              <span style={{
                fontWeight: 600,
                lineHeight: 1.3,
                textTransform: controlCopy.capitalizeSubtitle ? 'capitalize' : 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>{controlCopy.subtitle}</span>
            </span>
            <span style={{ fontSize: 10, flexShrink: 0 }}>{showPicker ? '▲' : '▼'}</span>
          </button>

          <button
            type="button"
            data-testid="reports-period-next"
            aria-label="Período siguiente"
            disabled={!canShiftPeriod}
            onClick={() => shiftPeriod(1)}
            style={{
              background: canShiftPeriod ? '#111' : '#161616',
              border: '1px solid #2a2a2a',
              borderRadius: 10,
              color: canShiftPeriod ? '#e5e5e5' : '#52525b',
              fontSize: 18,
              cursor: canShiftPeriod ? 'pointer' : 'not-allowed',
            }}
          >
            ›
          </button>
        </div>

        {showPicker && (
          <div data-testid="reports-date-picker" style={{ ...cardStyle, marginBottom: 16 }}>
            {/* Presets */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {PRESETS.map(p => (
                <button
                  key={p.key}
                  type="button"
                  data-testid={`reports-preset-${p.key}`}
                  onClick={() => handlePreset(p.key)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                    cursor: 'pointer',
                    border: activePreset?.key === p.key ? '1px solid #22c55e' : '1px solid #333',
                    background: activePreset?.key === p.key ? '#22c55e22' : '#111',
                    color: activePreset?.key === p.key ? '#22c55e' : '#a1a1aa',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <MiniCalendar
              key={`${startDate}:${endDate}:${calendarFocusDate}`}
              startDate={startDate}
              endDate={endDate}
              focusDate={calendarFocusDate}
              onSelect={handleCustomDate}
            />
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
                {expenseChart.trendTotal !== null && (
                  <span style={{ fontSize: 12, color: '#f59e0b' }}>
                    Tendencia lineal: {formatCurrency(expenseChart.trendTotal, 'CLP')}
                  </span>
                )}
              </div>
              {expenseChart.data.every(d => !d.actual && !d.trend) ? (
                <div style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 0', fontSize: 13 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📉</div>
                  Sin gastos en este período
                </div>
              ) : (
                <>
                  <div
                    data-testid="expense-chart"
                    data-expense-chart={JSON.stringify(
                      expenseChart.data.map(({ date, actual, trend }) => ({ date, actual, trend }))
                    )}
                    style={{ width: '100%', height: 200 }}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={expenseChart.data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#555' }} tickLine={false} axisLine={false}
                          interval={Math.max(0, Math.floor(expenseChart.data.length / 6) - 1)} />
                        <YAxis tick={{ fontSize: 10, fill: '#555' }} tickLine={false} axisLine={false} width={45} domain={[0, 'auto']}
                          tickFormatter={(v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                        <Tooltip content={(props: TooltipContentProps<number, string>) => <ChartTooltip {...props} color="#ef4444" />} />
                        <Line type="monotone" dataKey="actual" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls={false} />
                        <Line type="linear" dataKey="trend" stroke="#eab308" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
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
                      <Tooltip content={(props: TooltipContentProps<number, string>) => <ChartTooltip {...props} color="#22c55e" />} />
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
                      <Tooltip content={(props: TooltipContentProps<number, string>) => <ChartTooltip {...props} color="#e5e5e5" />} />
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
