import { and, eq, or, sql } from 'drizzle-orm'
import { db, movements, transfers } from '@/lib/db'

export async function getPendingReviewItemCount(spaceId: string): Promise<number> {
  const [result] = await db
    .select({
      count: sql<number>`
        COUNT(*) FILTER (WHERE ${transfers.id} IS NULL)
        + COUNT(DISTINCT ${transfers.id})
      `,
    })
    .from(movements)
    .leftJoin(transfers, or(eq(transfers.sourceMovementId, movements.id), eq(transfers.destinationMovementId, movements.id)))
    .where(and(eq(movements.spaceId, spaceId), eq(movements.needsReview, true)))

  return Number(result?.count ?? 0)
}
