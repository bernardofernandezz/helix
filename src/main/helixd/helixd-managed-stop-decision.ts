// Exclusive hard links arbitrate stop versus cancel; cancel cannot succeed once dispatch wins.
import { linkSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { writeDurableSecureJsonFile } from '../../shared/secure-file'
import {
  HelixdManagedStopDecisionSchema,
  HelixdManagedStopRequestSchema,
  type HelixdManagedStopDecision,
  type HelixdManagedStopRequest
} from '../../shared/helixd-stop-request'
import { helixdStopReceiptPath, readHelixdStopReceipt } from './helixd-completed-stop-receipt'
import { hasErrorCode } from '../daemon/daemon-process-inspection'

type HelixdManagedStopDecisionValue = HelixdManagedStopDecision['decision']

export function readHelixdManagedStopDecision(
  request: HelixdManagedStopRequest
): HelixdManagedStopDecisionValue | null {
  return (
    readHelixdStopReceipt(request, 'decision', HelixdManagedStopDecisionSchema)?.decision ?? null
  )
}

export function claimHelixdManagedStopDecision(
  input: HelixdManagedStopRequest,
  decision: HelixdManagedStopDecisionValue
): HelixdManagedStopDecisionValue {
  const request = HelixdManagedStopRequestSchema.parse(input)
  const path = helixdStopReceiptPath(request, 'decision')
  const staged = `${path}.${process.pid}.${randomUUID()}.staged`
  const record: HelixdManagedStopDecision = {
    schemaVersion: 1,
    kind: 'helixd_managed_stop_decision',
    request,
    decision
  }
  if (!writeDurableSecureJsonFile(staged, record)) {
    rmSync(staged, { force: true })
    throw new Error('helixd_managed_stop_decision_permissions_unconfirmed')
  }
  try {
    linkSync(staged, path)
    return decision
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) {
      throw error
    }
    const standing = readHelixdManagedStopDecision(request)
    if (!standing) {
      throw new Error('helixd_managed_stop_decision_unverifiable')
    }
    return standing
  } finally {
    rmSync(staged, { force: true })
  }
}
