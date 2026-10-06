import { db, type NewMovement } from '@/lib/db'
import { domainExecution } from './execution-context'

/** Origin policy belongs below every Ledger/import creation, including nested workflows. */
export function insertLedgerMovements(client: Pick<typeof db, 'insert'>) {
  return {
    values(input: NewMovement | NewMovement[]) {
      const context = domainExecution.getStore()
      const values = (Array.isArray(input) ? input : [input]).map(value => {
        if (!context) return value
        context.createdMovementIds.add(value.id)
        return { ...value, needsReview: true }
      })
      return client.insert(dbSchemaMovements).values(values)
    },
  }
}
import { movements as dbSchemaMovements } from '@/lib/db'
