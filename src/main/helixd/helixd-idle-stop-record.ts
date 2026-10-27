// Consume clean idle-stop evidence once; discard failed stops so later crashes cannot inherit it.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { readNodeFileSyncWithinLimit } from '../../shared/node-bounded-file-reader'
import { writeDurableSecureJsonFile } from '../../shared/secure-file'
import {
  HELIXD_IDLE_STOP_RECORD_FILENAME,
  HelixdIdleStopRecordSchema,
  type HelixdIdleStopRecord
} from '../../shared/helixd-idle-exit'
import type { HelixdIdleExitEvidence } from './helixd-idle-exit-monitor'
import { hasErrorCode } from '../daemon/daemon-process-inspection'

const RECORD_MAX_BYTES = 16 * 1024

export function helixdIdleStopRecordPath(userDataPath: string): string {
  return join(userDataPath, HELIXD_IDLE_STOP_RECORD_FILENAME)
}

export function writeHelixdIdleStopRecord(
  userDataPath: string,
  evidence: HelixdIdleExitEvidence,
  version: string
): void {
  const record: HelixdIdleStopRecord = {
    schemaVersion: 1,
    kind: 'helixd_idle_stop',
    pid: process.pid,
    version,
    quietSince: new Date(evidence.quietSince).toISOString(),
    stoppedAt: new Date(evidence.stoppedAt).toISOString(),
    idleTimeoutMs: evidence.timeoutMs
  }
  if (!writeDurableSecureJsonFile(helixdIdleStopRecordPath(userDataPath), record)) {
    throw new Error('helixd_idle_stop_record_permissions_unconfirmed')
  }
}

export function consumeHelixdIdleStopRecord(userDataPath: string): HelixdIdleStopRecord | null {
  const path = helixdIdleStopRecordPath(userDataPath)
  let record: HelixdIdleStopRecord | null = null
  try {
    const raw = readNodeFileSyncWithinLimit(path, RECORD_MAX_BYTES).buffer.toString('utf8')
    record = HelixdIdleStopRecordSchema.parse(JSON.parse(raw))
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null
    }
    console.error('[helixd] ignoring an unreadable idle-stop record:', error)
  }
  rmSync(path, { force: true })
  return record
}

export function discardHelixdIdleStopRecord(userDataPath: string): void {
  rmSync(helixdIdleStopRecordPath(userDataPath), { force: true })
}
