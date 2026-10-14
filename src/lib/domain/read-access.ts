import { sql, and, eq, inArray } from 'drizzle-orm'
import { categories } from '@/lib/db'
import { domainExecution } from './execution-context'

// Category labels always belong to the selected Space, even with a wider grant.
export function categoryReadAccess(spaceId: string) {
  const execution = domainExecution.getStore()
  return and(eq(categories.spaceId, spaceId), execution
    ? inArray(categories.spaceId, execution.spaces.map(space => space.id)) : undefined)
}
export function otherSpaceReadAccess() {
  const execution = domainExecution.getStore()
  return execution ? sql`other_membership.space_id IN ${execution.spaces.map(space => space.id)}` : sql`TRUE`
}
