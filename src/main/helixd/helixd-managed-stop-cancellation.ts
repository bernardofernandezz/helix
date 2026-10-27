import { rmSync } from 'node:fs'
import type {
  HelixdManagedStopCancellation,
  HelixdManagedStopRequest
} from '../../shared/helixd-stop-request'
import { claimHelixdManagedStopDecision } from './helixd-managed-stop-decision'
import {
  helixdManagedStopRequestPath,
  readHelixdManagedStopRequest
} from './helixd-managed-stop-request'

/** Dispatched stops cannot be canceled; their completion verdict remains authoritative. */
export function cancelHelixdManagedStop(
  request: HelixdManagedStopRequest
): HelixdManagedStopCancellation['outcome'] {
  const outcome = claimHelixdManagedStopDecision(request, 'canceled')
  if (outcome === 'canceled') {
    withdrawHelixdManagedStopRequest(request)
  }
  return outcome
}

export function withdrawHelixdManagedStopRequest(request: HelixdManagedStopRequest): void {
  const path = helixdManagedStopRequestPath(request.instance)
  try {
    if (readHelixdManagedStopRequest(path).transactionId === request.transactionId) {
      rmSync(path, { force: true })
    }
  } catch {
    // The persisted decision fences this transaction even if its request is gone.
  }
}
