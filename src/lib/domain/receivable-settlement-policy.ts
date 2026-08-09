type TransferIdentity = {
  sourceSpaceId: string
  destinationSpaceId: string
  sourceMovementId: string
}

export function isInterSpaceTransferSourceMovement(
  transfer: TransferIdentity | null,
  movementId: string,
): boolean {
  return Boolean(
    transfer &&
    transfer.sourceMovementId === movementId &&
    transfer.sourceSpaceId !== transfer.destinationSpaceId,
  )
}
