// Request shutdown without signaling; only kernel identity, owner change or PID absence proves exit.
import { setTimeout as delay } from 'node:timers/promises'
import { writeDurableSecureJsonFile } from '../../shared/secure-file'
import {
  HelixdManagedStopRequestSchema,
  helixdManagedStopRequestKey,
  type HelixdManagedStopInstance,
  type HelixdManagedStopRequest,
  type HelixdManagedStopVerdict
} from '../../shared/helixd-stop-request'
import {
  compareHelixdProcessIdentity,
  recordedHelixdProcessIncarnation,
  type HelixdProcessIdentityReaders,
  type HelixdRecordedIdentity
} from './helixd-process-start-time'
import { hasErrorCode, inspectProcessSignal } from '../daemon/daemon-process-inspection'
import { persistHelixdCompletedStopReceipt } from './helixd-completed-stop-receipt'
import { readHelixdManagedStopDecision } from './helixd-managed-stop-decision'
import { withdrawHelixdManagedStopRequest } from './helixd-managed-stop-cancellation'
import {
  helixdInstanceLockNames,
  helixdManagedStopRequestPath,
  readHelixdInstanceLockNaming,
  readHelixdManagedStopRequest
} from './helixd-managed-stop-request'
import {
  HELIXD_STOP_COMPLETION_POLL_ATTEMPTS,
  HELIXD_STOP_COMPLETION_POLL_MS
} from './helixd-stop-deadlines'

type HelixdProcessProbe = (pid: number) => 'alive' | 'missing' | 'unverifiable'

export type HelixdManagedStopCompletionOptions = HelixdProcessIdentityReaders & {
  probeProcess?: HelixdProcessProbe
  sleep?: () => Promise<void>
  attempts?: number
  now?: () => Date
}

function defaultProbe(pid: number): ReturnType<HelixdProcessProbe> {
  const signal = inspectProcessSignal(pid)
  // EPERM proves some process holds the PID; it cannot prove ours exited.
  return signal === 'occupied' ? 'alive' : signal === 'missing' ? 'missing' : 'unverifiable'
}

function observeInstance(
  instance: HelixdManagedStopInstance,
  recorded: HelixdRecordedIdentity,
  options: HelixdManagedStopCompletionOptions
): HelixdManagedStopVerdict {
  const probe = (options.probeProcess ?? defaultProbe)(instance.pid)
  if (probe !== 'alive') {
    return probe === 'missing' ? 'exited' : 'unverifiable'
  }
  // Wall-clock drift alone cannot prove PID reuse.
  const identity = compareHelixdProcessIdentity(instance.pid, recorded, options)
  return identity === 'differs' ? 'exited' : identity === 'unproven' ? 'unverifiable' : 'live'
}

/** Recover incarnation data from the lock for older clients that omit it. */
function recordedIdentity(instance: HelixdManagedStopInstance): HelixdRecordedIdentity {
  if (recordedHelixdProcessIncarnation(instance)) {
    return instance
  }
  let record: HelixdRecordedIdentity | null = null
  try {
    record = readHelixdInstanceLockNaming(instance)
  } catch {
    return instance
  }
  if (!record) {
    return instance
  }
  return { ...instance, ...recordedHelixdProcessIncarnation(record), identity: record.identity }
}

export async function completeHelixdManagedStop(
  input: HelixdManagedStopRequest,
  options: HelixdManagedStopCompletionOptions = {}
): Promise<HelixdManagedStopVerdict> {
  const request = HelixdManagedStopRequestSchema.parse(input)
  const attempts = options.attempts ?? HELIXD_STOP_COMPLETION_POLL_ATTEMPTS
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 240) {
    throw new Error('helixd_managed_stop_invalid_attempts')
  }
  const completed = (): 'exited' => {
    persistHelixdCompletedStopReceipt(request, (options.now ?? (() => new Date()))())
    return 'exited'
  }
  const recorded = recordedIdentity(request.instance)
  let verdict = observeInstance(request.instance, recorded, options)
  if (verdict !== 'live') {
    return verdict === 'exited' ? completed() : verdict
  }
  if (!lockStillNamesInstance(request.instance)) {
    // A live process that relinquished its lock is no longer ours to address.
    return 'unverifiable'
  }
  if (readHelixdManagedStopDecision(request) === 'canceled') {
    return 'live'
  }
  const requestPath = helixdManagedStopRequestPath(request.instance)
  if (!existingRequestMatches(requestPath, request)) {
    return 'unverifiable'
  }
  if (!writeDurableSecureJsonFile(requestPath, request)) {
    throw new Error('helixd_managed_stop_request_permissions_unconfirmed')
  }
  // A cancel between the first check and write had no request file to remove.
  if (readHelixdManagedStopDecision(request) === 'canceled') {
    withdrawHelixdManagedStopRequest(request)
    return 'live'
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    await (options.sleep ?? (() => delay(HELIXD_STOP_COMPLETION_POLL_MS)))()
    verdict = observeInstance(request.instance, recorded, options)
    if (verdict !== 'live') {
      return verdict === 'exited' ? completed() : verdict
    }
  }
  return 'live'
}

function lockStillNamesInstance(instance: HelixdManagedStopInstance): boolean {
  try {
    return helixdInstanceLockNames(instance)
  } catch {
    return false
  }
}

function existingRequestMatches(path: string, request: HelixdManagedStopRequest): boolean {
  try {
    return (
      helixdManagedStopRequestKey(readHelixdManagedStopRequest(path)) ===
      helixdManagedStopRequestKey(request)
    )
  } catch (error) {
    return hasErrorCode(error, 'ENOENT')
  }
}
