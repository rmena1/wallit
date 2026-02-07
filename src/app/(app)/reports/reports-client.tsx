'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { formatCurrency } from '@/lib/utils'
import { getReportData, type ReportData, type DailyData } from '@/lib/actions/reports'
import {
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

function getDefaultRange(): [string, string] {
  const n = new Date()
  return [fmt(new Date(n.getFullYear(), n.getMonth(), 1)), fmt(new Date(n.getFullYear(), n.getMonth() + 1, 0))]
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

// ─── Chart data builders ─────────────────────────────────────────────────────

function buildExpenseChart(dailyData: DailyData[], startDate: string, endDate: string) {
  const days = daysInRange(startDate, endDate)
  const map = new Map(dailyData.map(d => [d.date, d.expense]))
  const today = fmt(new Date())

  // Build cumulative actual values for all days up to today
  let cumulative = 0
  let totalActualExpense = 0
  let actualDaysCount = 0
  const cumulativeByDay = new Map<string, number>()

  for (const day of days) {
    if (day > today) break  // Stop at today - no future data
    const val = map.get(day) || 0
    cumulative += val
    cumulativeByDay.set(day, cumulative)
    totalActualExpense = cumulative
    actualDaysCount++
  }

  // Linear regression / trend calculation
  // With 1 point: use daily rate from that single point (slope = cumulative/dayIndex, intercept = 0)
  // With 2+ points: standard linear regression on cumulative values
  let trendSlope = 0, trendIntercept = 0
  let hasTrend = false

  if (actualDaysCount >= 2) {
    const points: { x: number; y: number }[] = []
    let idx = 0
    for (const day of days) {
      if (day > today) break  // Only use data up to today for trend calc
      idx++
      points.push({ x: idx, y: (cumulativeByDay.get(day) || 0) / 100 })
    }
    const n = points.length
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
    for (const p of points) {
      sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumX2 += p.x * p.x
    }
    trendSlope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
    trendIntercept = (sumY - trendSlope * sumX) / n
    hasTrend = true
  } else if (actualDaysCount === 1) {
    // Single data point: extrapolate linearly from 0 through the single point
    // trend(x) = (totalActualExpense/100 / actualDayIndex) * x
    // Find which day index the single actual day is at
    const singleDayIndex = days.indexOf([...cumulativeByDay.keys()].pop()!) + 1
    trendSlope = (totalActualExpense / 100) / singleDayIndex
    trendIntercept = 0
    hasTrend = true
  }

  // Build data array for ALL days in range
  const dailyRate = actualDaysCount > 0 ? totalActualExpense / actualDaysCount : 0
  let projCumulative = totalActualExpense
  const data: { date: string; label: string; actual: number | null; projected: number | null; trend: number | null }[] = []

  for (let i = 0; i < days.length; i++) {
    const day = days[i]
    const dayIndex = i + 1
    const trendVal = hasTrend ? Math.max(0, trendSlope * dayIndex + trendIntercept) : null
    
    // Check if this day is in the future (after today)
    const isFutureDay = day > today

    if (!isFutureDay) {
      // Actual data day (today or past)
      const actualVal = (cumulativeByDay.get(day) || 0) / 100
      data.push({
        date: day, label: day.slice(5),
        actual: actualVal,
        projected: day === today ? actualVal : null, // connect projection start at today
        trend: trendVal,
      })
    } else {
      // Future projected day - NO actual data
      projCumulative += dailyRate
      data.push({
        date: day, label: day.slice(5),
        actual: null,  // MUST be null for future days
        projected: projCumulative / 100,
        trend: trendVal,
      })
    }
  }

  // Gasto esperado = (totalGasto / díasTranscurridos) * díasTotalesDelPeriodo
  const projectedTotal = actualDaysCount > 0 ? (totalActualExpense / actualDaysCount) * days.length : 0
  return { data, projectedTotal }
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

function ChartTooltip({ active, payload, label, color }: any) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, padding: '6px 10px', fontSize: 12, color }}>
      <div style={{ color: '#888', marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{val != null ? formatCurrency(Math.round(val * 100), 'CLP') : ''}</div>
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

export function ReportsPage({ initialData, initialStartDate, initialEndDate }: ReportsPageProps) {
  const [dateRange, setDateRange] = useState<[string, string]>([initialStartDate, initialEndDate])
  const [activePreset, setActivePreset] = useState('Este mes')
  const [showPicker, setShowPicker] = useState(false)
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [data, setData] = useState<ReportData | null>(initialData)
  const [loading, setLoading] = useState(false)

  // Track whether we're still on the initial server-prefetched state
  const isInitial = useRef(true)

  const fetchData = useCallback(async () => {
    // Skip fetch on mount — we already have server-prefetched data
    if (isInitial.current) {
      isInitial.current = false
      return
    }
    setLoading(true)
    try {
      const d = await getReportData(dateRange[0], dateRange[1], categoryId || undefined, accountId || undefined)
      setData(d)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [dateRange, categoryId, accountId])

  useEffect(() => { fetchData() }, [fetchData])

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
    data ? buildExpenseChart(data.dailyData, dateRange[0], dateRange[1]) : { data: [], projectedTotal: 0 },
    [data, dateRange])
  const incomeChart = useMemo(() =>
    data ? buildIncomeChart(data.dailyData, dateRange[0], dateRange[1]) : [],
    [data, dateRange])
  const balanceChart = useMemo(() =>
    data ? buildBalanceChart(data.dailyData, dateRange[0], dateRange[1]) : [],
    [data, dateRange])

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
                  <div style={{ fontSize: 11, color: '#71717a', marginBottom: 4 }}>{c.label}</div>
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
              {expenseChart.data.every(d => !d.actual && !d.projected) ? (
                <div style={{ textAlign: 'center', color: '#52525b', padding: '32px 0', fontSize: 13 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📉</div>
                  Sin gastos en este período
                </div>
              ) : (
                <div style={{ width: '100%', height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={expenseChart.data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#555' }} tickLine={false} axisLine={false}
                        interval={Math.max(0, Math.floor(expenseChart.data.length / 6) - 1)} />
                      <YAxis tick={{ fontSize: 10, fill: '#555' }} tickLine={false} axisLine={false} width={45} domain={[0, 'auto']}
                        tickFormatter={(v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                      <Tooltip content={<ChartTooltip color="#ef4444" />} />
                      <Line type="monotone" dataKey="actual" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls={false} />
                      <Line type="monotone" dataKey="projected" stroke="#ef4444" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} />
                      <Line type="monotone" dataKey="trend" stroke="#eab308" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Chart 2: Income */}
            <div style={cardStyle}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: '#e5e5e5', margin: '0 0 12px' }}>📈 Ingresos</h2>
              {incomeChart.every(d => d.income === 0 || d.income === null) ? (
                <div style={{ textAlign: 'center', color: '#52525b', padding: '32px 0', fontSize: 13 }}>
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
                      <Tooltip content={<ChartTooltip color="#22c55e" />} />
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
                <div style={{ textAlign: 'center', color: '#52525b', padding: '32px 0', fontSize: 13 }}>
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
                      <Tooltip content={<ChartTooltip color="#e5e5e5" />} />
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
                <div style={{ textAlign: 'center', color: '#52525b', padding: '20px 0', fontSize: 13 }}>Sin gastos en este período</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {data.categorySpending.map((cat, i) => {
                    const max = data.categorySpending[0]?.total || 1
                    return (
                      <div key={i}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 16 }}>{cat.emoji}</span>
                            <span style={{ fontSize: 14, color: '#d4d4d8' }}>{cat.name}</span>
                            <span style={{ fontSize: 11, color: '#52525b' }}>({cat.count})</span>
                          </div>
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#f87171' }}>{formatCurrency(cat.total, 'CLP')}</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, backgroundColor: '#27272a', overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 3, backgroundColor: '#ef4444', width: `${(cat.total / max) * 100}%`, transition: 'width 0.3s ease' }} />
                        </div>
                      </div>
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
    </>
  )
}
