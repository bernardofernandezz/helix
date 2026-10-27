/** Pin every journaled slot needed for recovery. An unreadable journal or unjournaled held fence hides transaction state, so GC must retain everything. */
import { helixdInstallDirNames } from '../managed-server/activation/helixd-activation-record'
import type { HelixdActivationTransaction } from '../managed-server/activation/helixd-activation-transaction'
import { readHelixdActivationTransaction } from '../managed-server/activation/helixd-activation-transaction-store'
import { helixdActivationFenceExists } from '../managed-server/activation/helixd-activation-lock'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'
import type { HelixdRemoteExecTarget } from '../managed-server/install/helixd-remote-runtime-control'

type HelixdGcTransactionPins = { state: 'pinned'; dirNames: string[] } | { state: 'keep-all' }

function transactionVersions(transaction: HelixdActivationTransaction): (string | null)[] {
  const records = [transaction.recordBefore, transaction.recordAfter]
  const fromRecords = records.flatMap((record) => (record ? [record.active, record.previous] : []))
  if (transaction.operation === 'activate') {
    return [...fromRecords, transaction.candidateVersion]
  }
  return transaction.operation === 'rollback'
    ? [...fromRecords, transaction.incumbentVersion, transaction.targetVersion]
    : fromRecords
}

export async function readHelixdGcTransactionPins(
  target: HelixdRemoteExecTarget & { remoteHome: string }
): Promise<HelixdGcTransactionPins> {
  try {
    const transaction = await readHelixdActivationTransaction(target)
    if (!transaction) {
      // An unjournaled fence may be a transaction starting or an interrupted release.
      return (await helixdActivationFenceExists(target))
        ? { state: 'keep-all' }
        : { state: 'pinned', dirNames: [] }
    }
    return { state: 'pinned', dirNames: helixdInstallDirNames(transactionVersions(transaction)) }
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return { state: 'keep-all' }
  }
}
