// Readiness and instance-lock records must agree before the slot's own build requests a stop.
import { randomUUID } from 'node:crypto'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { selectHelixdSlotRuntimeCommand } from '../install/helixd-remote-runtime'
import {
  parseHelixdReadinessWaitOutput,
  readHelixdReadinessNowCommand
} from '../install/helixd-remote-readiness-wait'
import { execHelixdRemote } from '../install/helixd-remote-runtime-control'
import { readBoundedHelixdRemoteRecord } from '../install/helixd-remote-record-file'
import { helixdSlotDir, type HelixdSlotOptions } from '../../ssh/helixd-recovery-slot'
import { isWindowsRemoteHost, joinRemotePath } from '../../ssh/ssh-remote-platform'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import {
  helixdWindowsNodeCommandLine,
  helixdWindowsSlotOpCommand,
  readHelixdWindowsEncodedAnswer
} from '../install/helixd-remote-windows-node'
import { HELIXD_WINDOWS_RUNTIME_MARKER } from '../host-state/helixd-windows-host-script'
import {
  HELIXD_LOCK_FILE_NAME,
  parseHelixdInstanceLockRecord
} from '../../helixd/helixd-instance-lock'
import {
  HELIXD_CANCEL_MANAGED_STOP_FLAG,
  HELIXD_COMPLETE_MANAGED_STOP_FLAG,
  HELIXD_MANAGED_STOP_REQUEST_FILE_FLAG,
  HELIXD_STOP_REQUESTS_CAPABILITY,
  HelixdManagedStopCancellationSchema,
  HelixdManagedStopCompletionSchema,
  type HelixdManagedStopCancellation,
  type HelixdManagedStopCompletion,
  type HelixdManagedStopContext,
  type HelixdManagedStopRequest
} from '../../../shared/helixd-stop-request'

const LOCK_RECORD_MAX_BYTES = 64 * 1024

export type HelixdManagedStopTarget =
  | { state: 'ready'; context: HelixdManagedStopContext }
  | { state: 'refused'; verdict: 'unverifiable'; code: string; reason: string }

function refused(code: string, reason: string): HelixdManagedStopTarget {
  return { state: 'refused', verdict: 'unverifiable', code, reason }
}

export async function readRemoteHelixdManagedStopTarget(
  options: HelixdSlotOptions,
  version: string
): Promise<HelixdManagedStopTarget> {
  const slotDir = helixdSlotDir(options, version)
  const readiness = parseHelixdReadinessWaitOutput(
    options.host,
    await execHelixdRemote(options, readHelixdReadinessNowCommand(options.host, slotDir))
  )
  if (readiness.state !== 'ready' || !readiness.readiness.health) {
    return refused(
      'helixd_managed_stop_readiness_unverifiable',
      `helixd ${version} has no readable readiness record, so the running instance is unknown.`
    )
  }
  const { health, runtimeId } = readiness.readiness
  if (health.stopRequests !== HELIXD_STOP_REQUESTS_CAPABILITY) {
    return refused(
      'helixd_managed_stop_unsupported',
      `helixd ${version} predates managed stop requests; it can only be stopped by signal.`
    )
  }
  const lockPath = joinRemotePath(options.host, options.userDataDir, HELIXD_LOCK_FILE_NAME)
  const lockRead = await readBoundedHelixdRemoteRecord(options, lockPath, LOCK_RECORD_MAX_BYTES)
  const lock = lockRead.state === 'present' ? parseHelixdInstanceLockRecord(lockRead.raw) : null
  if (!lock || lock.pid !== health.pid || !runtimeId) {
    return refused(
      'helixd_managed_stop_instance_unverifiable',
      `The instance lock does not name the helixd ${version} that published readiness.`
    )
  }
  return {
    state: 'ready',
    context: {
      version,
      runtimeId,
      instance: {
        pid: lock.pid,
        startedAtMs: lock.startedAtMs,
        // Newer slots use boot/start ticks to avoid wall-clock drift; older readers drop them.
        ...(lock.linuxStartTicks && lock.bootId
          ? { linuxStartTicks: lock.linuxStartTicks, bootId: lock.bootId }
          : {}),
        nonce: lock.nonce,
        lockPath
      }
    }
  }
}

export async function completeRemoteHelixdManagedStop(
  options: HelixdSlotOptions,
  request: HelixdManagedStopRequest
): Promise<HelixdManagedStopCompletion> {
  return HelixdManagedStopCompletionSchema.parse(
    await runSlotCommand(options, request, HELIXD_COMPLETE_MANAGED_STOP_FLAG)
  )
}

export async function cancelRemoteHelixdManagedStop(
  options: HelixdSlotOptions,
  request: HelixdManagedStopRequest
): Promise<HelixdManagedStopCancellation> {
  return HelixdManagedStopCancellationSchema.parse(
    await runSlotCommand(options, request, HELIXD_CANCEL_MANAGED_STOP_FLAG)
  )
}

// The slot's own build owns its stop-request format.
async function runSlotCommand(
  options: HelixdSlotOptions,
  request: HelixdManagedStopRequest,
  flag: string
): Promise<unknown> {
  const slotDir = helixdSlotDir(options, request.version)
  const entry = joinRemotePath(options.host, slotDir, 'helixd.js')
  const output = isWindowsRemoteHost(options.host)
    ? await runWindowsSlotCommand(options, slotDir, entry, request, flag)
    : await execHelixdRemote(
        options,
        `${selectHelixdSlotRuntimeCommand(options.host, slotDir, options.nodePath)} && ` +
          `"$helixd_runtime" ${quotePosixShell(entry)} ${flag} ${quotePosixShell(JSON.stringify(request))}`
      )
  const line = output
    .trim()
    .split('\n')
    .findLast((candidate) => candidate.trim().startsWith('{'))
  if (!line) {
    throw new Error('helixd managed stop command returned no verifiable answer')
  }
  const parsed: unknown = JSON.parse(line)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('helixd managed stop command returned no verifiable answer')
  }
  if (!('transactionId' in parsed) || parsed.transactionId !== request.transactionId) {
    throw new Error('helixd managed stop command answered another transaction')
  }
  return parsed
}

// Stage JSON on Windows to avoid two command-line quoting layers.
async function runWindowsSlotCommand(
  options: HelixdSlotOptions,
  slotDir: string,
  entry: string,
  request: HelixdManagedStopRequest,
  flag: string
): Promise<string> {
  const runtime = readHelixdWindowsEncodedAnswer(
    await execHelixdRemote(
      options,
      helixdWindowsSlotOpCommand(options.host, slotDir, 'slot-runtime', [slotDir])
    ),
    HELIXD_WINDOWS_RUNTIME_MARKER
  )
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this helixd slot needs.')
  }
  const staged = joinRemotePath(options.host, slotDir, `.helixd-stop-command-${randomUUID()}.json`)
  let removeStaged = true
  try {
    await options.conn.writeFile(staged, JSON.stringify(request), {
      hostPlatform: options.host,
      signal: options.signal
    })
    return await execHelixdRemote(
      options,
      helixdWindowsNodeCommandLine(runtime, [
        entry,
        flag,
        HELIXD_MANAGED_STOP_REQUEST_FILE_FLAG,
        staged
      ])
    )
  } catch (error) {
    // Unconfirmed commands may still be reading the staged request.
    removeStaged = !isUnconfirmedSshCommandTermination(error)
    throw error
  } finally {
    if (removeStaged) {
      await execHelixdRemote(
        options,
        helixdWindowsSlotOpCommand(options.host, slotDir, 'remove-file', [staged])
      ).catch(() => {})
    }
  }
}
