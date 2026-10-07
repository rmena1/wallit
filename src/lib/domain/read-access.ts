import { sql, inArray } from 'drizzle-orm'
import { categories } from '@/lib/db'
import { domainExecution } from './execution-context'

// Existing UI can retain historical category labels. A remote grant may cover a
// narrower set of Spaces and must never expose names outside that consent.
export function categoryReadAccess() {
  const execution = domainExecution.getStore()
  return execution ? inArray(categories.spaceId, execution.spaces.map(space => space.id)) : sql`TRUE`
}
export function otherSpaceReadAccess() {
  const execution = domainExecution.getStore()
  return execution ? sql`other_membership.space_id IN ${execution.spaces.map(space => space.id)}` : sql`TRUE`
}
