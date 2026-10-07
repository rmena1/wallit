import { AsyncLocalStorage } from 'node:async_hooks'
import type { getDb } from '@/lib/db'
import type { AvailableSpace } from '@/lib/spaces'

// Only trusted server code establishes this context, after OAuth validation.
// It is request-local: cookies and another caller's active Space never participate.
export type DomainExecution = {
  user: { id: string; email: string }
  space: AvailableSpace
  spaces: AvailableSpace[]
  allSpaces: boolean
  pendingMemberDestinationId?: string
  client: ReturnType<typeof getDb>
  createdMovementIds: Set<string>
}
export const domainExecution = new AsyncLocalStorage<DomainExecution>()
