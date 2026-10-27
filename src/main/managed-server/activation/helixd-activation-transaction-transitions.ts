import type { HelixdActivationRecord } from './helixd-activation-record'
import { HELIXD_ACTIVATION_TRANSACTION_SCHEMA_VERSION } from './helixd-activation-transaction-schema'
import type {
  HelixdActivateTransaction,
  HelixdRollbackTransaction
} from './helixd-activation-transaction'

export function createHelixdActivationTransaction(options: {
  transactionId: string
  candidateVersion: string
  appVersion?: string
  recordBefore: HelixdActivationRecord
  snapshotDirName: string
  now: Date
}): HelixdActivateTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: HELIXD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'activate',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    candidateVersion: options.candidateVersion,
    candidateAppVersion: options.appVersion ?? null,
    recordBefore: options.recordBefore,
    recordAfter: null,
    snapshot: { dirName: options.snapshotDirName, state: 'pending' }
  }
}

export function withHelixdActivationIncumbentStopped(
  transaction: HelixdActivateTransaction,
  now: Date
): HelixdActivateTransaction {
  return {
    ...transaction,
    phase: 'incumbent-stopped',
    updatedAt: now.toISOString()
  }
}

export function withHelixdActivationSnapshot(
  transaction: HelixdActivateTransaction,
  state: 'captured' | 'empty',
  now: Date
): HelixdActivateTransaction {
  return {
    ...transaction,
    phase: 'snapshot-captured',
    updatedAt: now.toISOString(),
    snapshot: { dirName: transaction.snapshot.dirName, state }
  }
}

export function withHelixdActivationCandidateReady(
  transaction: HelixdActivateTransaction,
  recordAfter: HelixdActivationRecord,
  now: Date
): HelixdActivateTransaction {
  return {
    ...transaction,
    phase: 'candidate-ready',
    updatedAt: now.toISOString(),
    recordAfter
  }
}

export function createHelixdRollbackTransaction(options: {
  transactionId: string
  incumbentVersion: string
  targetVersion: string
  recordBefore: HelixdActivationRecord
  recordAfter: HelixdActivationRecord
  rescueDirName: string
  now: Date
}): HelixdRollbackTransaction {
  const timestamp = options.now.toISOString()
  return {
    schemaVersion: HELIXD_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    transactionId: options.transactionId,
    operation: 'rollback',
    phase: 'prepared',
    startedAt: timestamp,
    updatedAt: timestamp,
    incumbentVersion: options.incumbentVersion,
    targetVersion: options.targetVersion,
    recordBefore: options.recordBefore,
    recordAfter: options.recordAfter,
    rescue: { dirName: options.rescueDirName, state: 'pending' }
  }
}

export function withHelixdRollbackPhase(
  transaction: HelixdRollbackTransaction,
  phase: 'incumbent-stopped' | 'rollback-state-restored' | 'target-ready',
  now: Date
): HelixdRollbackTransaction {
  return { ...transaction, phase, updatedAt: now.toISOString() }
}

export function withHelixdRollbackRescue(
  transaction: HelixdRollbackTransaction,
  state: 'captured' | 'empty',
  now: Date
): HelixdRollbackTransaction {
  return {
    ...transaction,
    phase: 'rescue-captured',
    updatedAt: now.toISOString(),
    rescue: { dirName: transaction.rescue.dirName, state }
  }
}
