// Unreadable activation records must fail closed; treating them as absent could overwrite a live install and its rollback target.
import type { HelixdHostTransport } from '../../ssh/helixd-host-transport'
import { RELAY_REMOTE_DIR } from '../../ssh/remote-exec/remote-frame-protocol'
import {
  HELIXD_ACTIVATION_FILENAME,
  emptyHelixdActivationRecord,
  parseHelixdActivationRecord,
  serializeHelixdActivationRecord,
  type HelixdActivationReadResult,
  type HelixdActivationRecord
} from './helixd-activation-record'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import {
  readBoundedHelixdRemoteRecord,
  writeAtomicHelixdRemoteRecord
} from '../install/helixd-remote-record-file'

const HELIXD_ACTIVATION_RECORD_MAX_BYTES = 64 * 1024

type ActivationRecordTarget = {
  conn: HelixdHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  signal?: AbortSignal
}

function helixdActivationPath(host: RemoteHostPlatform, remoteHome: string): string {
  return joinRemotePath(host, remoteHome, RELAY_REMOTE_DIR, HELIXD_ACTIVATION_FILENAME)
}

async function readActivationRecordState(
  options: ActivationRecordTarget
): Promise<HelixdActivationReadResult> {
  const read = await readBoundedHelixdRemoteRecord(
    options,
    helixdActivationPath(options.host, options.remoteHome),
    HELIXD_ACTIVATION_RECORD_MAX_BYTES
  )
  return read.state === 'absent' ? read : parseHelixdActivationRecord(read.raw)
}

export async function readHelixdActivationRecord(
  options: ActivationRecordTarget
): Promise<HelixdActivationRecord> {
  const parsed = await readActivationRecordState(options)
  if (parsed.state === 'ok') {
    return parsed.record
  }
  if (parsed.state === 'unreadable') {
    throw new Error(`Cannot read this host's helixd activation record: ${parsed.reason}`)
  }
  return emptyHelixdActivationRecord()
}

/** Refuse replacement of unreadable records, including schemas written by newer clients. */
export async function writeHelixdActivationRecord(
  options: ActivationRecordTarget,
  record: HelixdActivationRecord
): Promise<void> {
  const existing = await readActivationRecordState(options)
  if (existing.state === 'unreadable') {
    throw new Error(
      `Refusing to overwrite this host's helixd activation record: ${existing.reason}`
    )
  }
  await writeAtomicHelixdRemoteRecord(
    options,
    helixdActivationPath(options.host, options.remoteHome),
    serializeHelixdActivationRecord(record)
  )
}
