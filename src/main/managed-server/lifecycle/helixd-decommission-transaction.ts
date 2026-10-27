// Only process-exited may commit; dispatched phases nest under prepared for released readers.
import {
  serializeHelixdActivationRecord,
  withDeactivatedVersion,
  withDeactivatedVersionCommitted,
  type HelixdActivationRecord
} from '../activation/helixd-activation-record'
import { HELIXD_ACTIVATION_TRANSACTION_SCHEMA_VERSION } from '../activation/helixd-activation-transaction-schema'
import type { HelixdManagedStopRequest } from '../../../shared/helixd-stop-request'

export type HelixdDecommissionTransaction = {
  schemaVersion: typeof HELIXD_ACTIVATION_TRANSACTION_SCHEMA_VERSION
  transactionId: string
  operation: 'decommission'
  phase: 'prepared' | 'stop-dispatched' | 'process-exited'
  startedAt: string
  updatedAt: string
  activeVersion: string
  recordBefore: HelixdActivationRecord
  recordAfter: HelixdActivationRecord
  request: HelixdManagedStopRequest | null
}

/** Released desktops drop this field. */
type HelixdDecommissionDispatch = {
  phase: 'stop-dispatched' | 'process-exited'
  request: HelixdManagedStopRequest
}

type HelixdDecommissionJournal = Omit<HelixdDecommissionTransaction, 'phase' | 'request'> & {
  phase: 'prepared'
  request: null
  dispatched?: HelixdDecommissionDispatch
}

export type HelixdDecommissionRecoveryPlan =
  | { action: 'confirm-decommissioned'; version: string; record: HelixdActivationRecord | null }
  /** Completion or cancellation must settle a possibly delivered request. */
  | { action: 'resume-stop'; request: HelixdManagedStopRequest; record: HelixdActivationRecord }
  | { action: 'keep-serving'; version: string }

export function createHelixdDecommissionTransaction(options: {
  transactionId: string
  recordBefore: HelixdActivationRecord & { active: string }
  now: Date
}): HelixdDecommissionTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: HELIXD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'decommission',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    activeVersion: options.recordBefore.active,
    recordBefore: options.recordBefore,
    recordAfter: withDeactivatedVersion(options.recordBefore),
    request: null
  }
}

export function withHelixdDecommissionStopDispatched(
  transaction: HelixdDecommissionTransaction,
  request: HelixdManagedStopRequest,
  now: Date
): HelixdDecommissionTransaction {
  return { ...transaction, phase: 'stop-dispatched', updatedAt: now.toISOString(), request }
}

export function withHelixdDecommissionProcessExited(
  transaction: HelixdDecommissionTransaction,
  now: Date
): HelixdDecommissionTransaction {
  return { ...transaction, phase: 'process-exited', updatedAt: now.toISOString() }
}

/** Keep top-level prepared so released readers relaunch the recorded build instead of downgrading.
 * Their parser drops dispatched; their completed-stop path loses activeAppVersion protection. */
export function helixdDecommissionJournal(
  transaction: HelixdDecommissionTransaction
): HelixdDecommissionJournal {
  const { phase, request, ...rest } = transaction
  return phase === 'prepared' || !request
    ? { ...rest, phase: 'prepared', request: null }
    : { ...rest, phase: 'prepared', request: null, dispatched: { phase, request } }
}

export function helixdDecommissionTransactionDefect(
  transaction: HelixdDecommissionTransaction
): string | null {
  if (transaction.recordBefore.active !== transaction.activeVersion) {
    return 'decommission version does not match recordBefore'
  }
  if (
    serializeHelixdActivationRecord(transaction.recordAfter) !==
    serializeHelixdActivationRecord(withDeactivatedVersion(transaction.recordBefore))
  ) {
    return 'recordAfter is not the deactivated recordBefore'
  }
  if (transaction.request && transaction.request.version !== transaction.activeVersion) {
    return 'stop request names another version'
  }
  return null
}

export function planHelixdDecommissionRecovery(
  transaction: HelixdDecommissionTransaction,
  committed: boolean
): HelixdDecommissionRecoveryPlan {
  if (committed) {
    return { action: 'confirm-decommissioned', version: transaction.activeVersion, record: null }
  }
  if (transaction.phase === 'process-exited') {
    return {
      action: 'confirm-decommissioned',
      version: transaction.activeVersion,
      record: committedHelixdDecommissionRecord(transaction)
    }
  }
  if (transaction.phase === 'stop-dispatched' && transaction.request) {
    return {
      action: 'resume-stop',
      request: transaction.request,
      record: committedHelixdDecommissionRecord(transaction)
    }
  }
  return { action: 'keep-serving', version: transaction.activeVersion }
}

/** Preserve advisory fields alongside the journaled recordAfter. */
export function committedHelixdDecommissionRecord(
  transaction: HelixdDecommissionTransaction
): HelixdActivationRecord {
  return withDeactivatedVersionCommitted(transaction.recordBefore)
}
