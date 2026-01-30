import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getReportData } from '@/lib/actions/reports'
import { ReportsPage } from './reports-client'

function getDefaultRange(): [string, string] {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return [fmt(start), fmt(now)]
}

export default async function Reports() {
  const session = await getSession()
  if (!session) redirect('/login')

  const [startDate, endDate] = getDefaultRange()
  const initialData = await getReportData(startDate, endDate)

  return (
    <ReportsPage
      initialData={initialData}
      initialStartDate={startDate}
      initialEndDate={endDate}
    />
  )
}
