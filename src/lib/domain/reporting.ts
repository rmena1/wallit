import { sql } from 'drizzle-orm'
import { movements } from '@/lib/db'

export function reportableMovementSqlFilters(spaceId: string) {
  return [
    sql`${movements.spaceId} = ${spaceId}`,
    sql`${movements.needsReview} = false`,
    sql`(${movements.receivable} = false OR ${movements.receivable} IS NULL)`,
    sql`${movements.receivableId} IS NULL`,
    sql`${movements.transferId} IS NULL`,
    sql`${movements.transferPairId} IS NULL`,
    sql`(${movements.emergency} = false OR ${movements.emergency} IS NULL)`,
    sql`(${movements.loan} = false OR ${movements.loan} IS NULL)`,
    sql`${movements.loanId} IS NULL`,
  ]
}
