/** Stop files reach only the watching helixd; signals from stale PID records could stop an unrelated reused process. */
import { z } from 'zod'
import { openEnum } from './zod-salvage'

/** Plain request in the slot directory: the same graceful stop as SIGTERM. */
export const HELIXD_STOP_REQUEST_FILENAME = '.helixd-stop-request'
/** Prefix of an instance-bound request in the data root; older listeners never match it. */
export const HELIXD_MANAGED_STOP_REQUEST_PREFIX = '.helixd-managed-stop-request'
export const HELIXD_MANAGED_STOP_REQUEST_MAX_BYTES = 32 * 1024
export const HELIXD_STOP_RECEIPTS_DIRNAME = 'helixd-stop-receipts'
export const HELIXD_COMPLETE_MANAGED_STOP_FLAG = '--complete-managed-stop'
/** Names a staged request file instead of inline JSON; Windows hosts never put the JSON on argv. */
export const HELIXD_MANAGED_STOP_REQUEST_FILE_FLAG = '--request-file'

/** One helixd process: its PID, start time, and the instance lock record it published. */
export const HelixdManagedStopInstanceSchema = z.object({
  pid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  startedAtMs: z.number().finite().nonnegative().nullable(),
  /** Linux only, copied from the lock; older clients omit it and older slots drop it. */
  linuxStartTicks: z.string().regex(/^\d+$/).max(32).optional().catch(undefined),
  bootId: z.string().min(1).max(255).optional().catch(undefined),
  nonce: z.string().min(1).max(255),
  lockPath: z.string().min(1).max(4096)
})

// Older slots drop newer optional request fields rather than refuse the stop.
export const HelixdManagedStopRequestSchema = z.object({
  schemaVersion: z.literal(1),
  transactionId: z.uuid(),
  version: z.string().min(1).max(255),
  runtimeId: z.string().min(1).max(255),
  instance: HelixdManagedStopInstanceSchema,
  /** Best effort: also retire the terminal daemon if it is provably idle. Never blocks the stop. */
  retireIdleDaemon: z.literal(true).optional()
})

export type HelixdManagedStopInstance = z.infer<typeof HelixdManagedStopInstanceSchema>
export type HelixdManagedStopRequest = z.infer<typeof HelixdManagedStopRequestSchema>

/** Equality key for a request; omits the incarnation, which an older client recovering it drops. */
export function helixdManagedStopRequestKey(request: HelixdManagedStopRequest): string {
  const { instance, ...rest } = HelixdManagedStopRequestSchema.parse(request)
  const { linuxStartTicks: _ticks, bootId: _bootId, ...bound } = instance
  return JSON.stringify({ ...rest, instance: bound })
}
/** What a stopping helixd must match before a managed request may stop it. */
export type HelixdManagedStopContext = Omit<
  HelixdManagedStopRequest,
  'schemaVersion' | 'transactionId'
>

const STOP_VERDICTS = ['live', 'unverifiable', 'exited'] as const
const RETIREMENT_VERDICTS = ['retired', 'live', 'unverifiable'] as const

/** The execution host's verdict; `exited` only on proof, never on silence. */
export const HelixdManagedStopVerdictSchema = z.enum(STOP_VERDICTS)

/** `retired` only when the daemon accepted; a busy daemon stays up and keeps its terminals. */
export const HelixdDaemonRetirementVerdictSchema = z.enum(RETIREMENT_VERDICTS)

// Read by clients older than the slot that printed them: unknown fields and arms degrade.
const stopReplyRequestFields = HelixdManagedStopRequestSchema.shape

export const HelixdManagedStopCompletionSchema = z.object({
  ...stopReplyRequestFields,
  kind: z.literal('helixd_managed_stop_completion'),
  verdict: openEnum(STOP_VERDICTS, 'unverifiable'),
  receiptPersisted: z.boolean(),
  /** For a request that asked to retire the daemon, the outcome its receipt recorded. */
  retirement: openEnum(RETIREMENT_VERDICTS, 'unverifiable').optional()
})

/** What the stopping helixd observed about its daemon, written before it exits. */
export const HelixdDaemonRetirementRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('helixd_managed_stop_retirement'),
  request: HelixdManagedStopRequestSchema,
  retirement: HelixdDaemonRetirementVerdictSchema,
  liveSessions: z.number().int().nonnegative().nullable(),
  reason: z.string().max(4096).nullable()
})

export const HelixdCompletedStopReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('helixd_managed_stop_completed'),
  request: HelixdManagedStopRequestSchema,
  exitedAt: z.iso.datetime({ offset: true }),
  /** Present only when the request asked to retire the daemon. */
  retirement: HelixdDaemonRetirementVerdictSchema.optional()
})

export type HelixdManagedStopVerdict = z.infer<typeof HelixdManagedStopVerdictSchema>
export type HelixdManagedStopCompletion = z.infer<typeof HelixdManagedStopCompletionSchema>
export type HelixdCompletedStopReceipt = z.infer<typeof HelixdCompletedStopReceiptSchema>
export type HelixdDaemonRetirementVerdict = z.infer<typeof HelixdDaemonRetirementVerdictSchema>
export type HelixdDaemonRetirementRecord = z.infer<typeof HelixdDaemonRetirementRecordSchema>

export const HELIXD_CANCEL_MANAGED_STOP_FLAG = '--cancel-managed-stop'
/** Readiness `health.stopRequests`: this build consumes stop files and both commands above. */
export const HELIXD_STOP_REQUESTS_CAPABILITY = 1

/** Exclusive per-transaction creation ensures only helixd dispatch or client cancellation can win. */
export const HelixdManagedStopDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('helixd_managed_stop_decision'),
  request: HelixdManagedStopRequestSchema,
  decision: z.enum(['dispatched', 'canceled'])
})

/** `dispatched` means helixd already acted on the request; the caller must await its exit. */
export const HelixdManagedStopCancellationSchema = z.object({
  ...stopReplyRequestFields,
  kind: z.literal('helixd_managed_stop_cancellation'),
  // Unknown degrades to `dispatched`: the caller then awaits exit rather than assume a cancel.
  outcome: openEnum(['canceled', 'dispatched'], 'dispatched')
})

export type HelixdManagedStopDecision = z.infer<typeof HelixdManagedStopDecisionSchema>
export type HelixdManagedStopCancellation = z.infer<typeof HelixdManagedStopCancellationSchema>
