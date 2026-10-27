import {
  helixdActivationTransactionPath,
  parseHelixdActivationTransaction,
  serializeHelixdActivationTransaction,
  type HelixdActivationTransaction
} from './helixd-activation-transaction'
import {
  readBoundedHelixdRemoteRecord,
  writeAtomicHelixdRemoteRecord
} from '../install/helixd-remote-record-file'
import type { HelixdRemoteExecTarget } from '../install/helixd-remote-runtime-control'
import { currentHelixdFence } from './helixd-activation-fence-scope'

const HELIXD_ACTIVATION_TRANSACTION_MAX_BYTES = 64 * 1024

type HelixdActivationTransactionStoreOptions = HelixdRemoteExecTarget & { remoteHome: string }

/** Only verified absence returns null; unreadable journals retain the fence. */
export async function readHelixdActivationTransaction(
  options: HelixdActivationTransactionStoreOptions
): Promise<HelixdActivationTransaction | null> {
  const read = await readBoundedHelixdRemoteRecord(
    options,
    helixdActivationTransactionPath(options.host, options.remoteHome),
    HELIXD_ACTIVATION_TRANSACTION_MAX_BYTES
  )
  const parsed = parseHelixdActivationTransaction(read.state === 'present' ? read.raw : null)
  if (parsed.state === 'unreadable') {
    throw new Error(`Cannot read this host's helixd activation transaction: ${parsed.reason}`)
  }
  return parsed.state === 'ok' ? parsed.transaction : null
}

/** Stamp each write with its fence generation so release cannot delete another holder's journal. */
export function writeHelixdActivationTransaction(
  options: HelixdActivationTransactionStoreOptions,
  transaction: HelixdActivationTransaction
): Promise<void> {
  const fenceToken = currentHelixdFence()?.token
  return writeAtomicHelixdRemoteRecord(
    options,
    helixdActivationTransactionPath(options.host, options.remoteHome),
    serializeHelixdActivationTransaction(fenceToken ? { ...transaction, fenceToken } : transaction)
  )
}
