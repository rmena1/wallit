import assert from 'node:assert/strict'
import test from 'node:test'
import { isInterSpaceTransferSourceMovement } from '../src/lib/domain/receivable-settlement-policy.ts'

const interSpaceTransfer = {
  sourceSpaceId: 'personal',
  destinationSpaceId: 'casa',
  sourceMovementId: 'source-movement',
}

test('identifies only the source side of an Inter-Space Transfer', () => {
  assert.equal(isInterSpaceTransferSourceMovement(interSpaceTransfer, 'source-movement'), true)
  assert.equal(isInterSpaceTransferSourceMovement(interSpaceTransfer, 'destination-movement'), false)
})

test('rejects same-Space and missing transfer roots', () => {
  assert.equal(isInterSpaceTransferSourceMovement({
    ...interSpaceTransfer,
    destinationSpaceId: interSpaceTransfer.sourceSpaceId,
  }, 'source-movement'), false)
  assert.equal(isInterSpaceTransferSourceMovement(null, 'source-movement'), false)
})
