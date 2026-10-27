import { lstatSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { z } from 'zod'
import { readNodeFileSyncWithinLimit } from '../../shared/node-bounded-file-reader'
import { writeDurableSecureJsonFile } from '../../shared/secure-file'
import { hasErrorCode } from '../daemon/daemon-process-inspection'
import {
  HELIXD_STOP_RECEIPTS_DIRNAME,
  HelixdCompletedStopReceiptSchema,
  HelixdManagedStopRequestSchema,
  HelixdDaemonRetirementRecordSchema,
  helixdManagedStopRequestKey,
  type HelixdCompletedStopReceipt,
  type HelixdDaemonRetirementRecord,
  type HelixdManagedStopRequest
} from '../../shared/helixd-stop-request'

const RECEIPT_MAX_BYTES = 64 * 1024

type ReceiptKind = 'completed' | 'retirement' | 'decision'

export function helixdStopReceiptPath(
  request: HelixdManagedStopRequest,
  kind: ReceiptKind
): string {
  const { transactionId, instance } = HelixdManagedStopRequestSchema.parse(request)
  const suffix = kind === 'completed' ? '' : `.${kind}`
  return join(
    dirname(instance.lockPath),
    HELIXD_STOP_RECEIPTS_DIRNAME,
    `${transactionId}${suffix}.json`
  )
}

/** Absent returns null; mismatched request receipts throw. */
export function readHelixdStopReceipt<T extends { request: HelixdManagedStopRequest }>(
  request: HelixdManagedStopRequest,
  kind: ReceiptKind,
  schema: z.ZodType<T>
): T | null {
  const path = helixdStopReceiptPath(request, kind)
  try {
    if (!lstatSync(path).isFile()) {
      throw new Error('helixd_stop_receipt_unverifiable')
    }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null
    }
    throw error
  }
  const receipt = schema.parse(
    JSON.parse(readNodeFileSyncWithinLimit(path, RECEIPT_MAX_BYTES).buffer.toString('utf8'))
  )
  if (helixdManagedStopRequestKey(receipt.request) !== helixdManagedStopRequestKey(request)) {
    throw new Error('helixd_stop_receipt_mismatch')
  }
  return receipt
}

function writeReceipt(
  request: HelixdManagedStopRequest,
  kind: ReceiptKind,
  receipt: unknown
): void {
  if (!writeDurableSecureJsonFile(helixdStopReceiptPath(request, kind), receipt)) {
    throw new Error('helixd_stop_receipt_permissions_unconfirmed')
  }
}

export function readHelixdCompletedStopReceipt(
  request: HelixdManagedStopRequest
): HelixdCompletedStopReceipt | null {
  return readHelixdStopReceipt(request, 'completed', HelixdCompletedStopReceiptSchema)
}

/** Persist only after proven exit and fsync even existing receipts.
 * Missing retirement records remain unverifiable. */
export function persistHelixdCompletedStopReceipt(
  request: HelixdManagedStopRequest,
  exitedAt: Date
): HelixdCompletedStopReceipt {
  const parsed = HelixdManagedStopRequestSchema.parse(request)
  const retirement = parsed.retireIdleDaemon
    ? (readHelixdDaemonRetirementRecord(parsed)?.retirement ?? 'unverifiable')
    : undefined
  const receipt = readHelixdCompletedStopReceipt(parsed) ?? {
    schemaVersion: 1 as const,
    kind: 'helixd_managed_stop_completed' as const,
    request: parsed,
    exitedAt: exitedAt.toISOString(),
    ...(retirement ? { retirement } : {})
  }
  writeReceipt(parsed, 'completed', receipt)
  return receipt
}

export function readHelixdDaemonRetirementRecord(
  request: HelixdManagedStopRequest
): HelixdDaemonRetirementRecord | null {
  return readHelixdStopReceipt(request, 'retirement', HelixdDaemonRetirementRecordSchema)
}

export function persistHelixdDaemonRetirementRecord(
  request: HelixdManagedStopRequest,
  outcome: Pick<HelixdDaemonRetirementRecord, 'retirement' | 'liveSessions' | 'reason'>
): void {
  writeReceipt(request, 'retirement', {
    schemaVersion: 1,
    kind: 'helixd_managed_stop_retirement',
    request: HelixdManagedStopRequestSchema.parse(request),
    // Name fields explicitly; extra in-process fields would fail the strict schema.
    retirement: outcome.retirement,
    liveSessions: outcome.liveSessions,
    reason: outcome.reason
  })
}
