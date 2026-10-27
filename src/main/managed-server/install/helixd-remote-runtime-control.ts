import { HELIXD_STARTUP_READINESS_TIMEOUT_MS } from '../../../shared/helixd-profile-preflight'
import {
  helixdLaunchCommand,
  parseHelixdReadinessOutput,
  type HelixdLaunchSpec,
  type HelixdReadinessParse
} from './helixd-remote-launch'
import {
  readWindowsHelixdLaunchReport,
  readWindowsHelixdSlotRuntime,
  readWindowsHelixdSlotEntry,
  windowsHelixdLaunchCommand,
  windowsHelixdLaunchRuntimeCommand
} from './helixd-remote-launch-windows'
import {
  HELIXD_READINESS_WAIT_MAX_SECONDS,
  helixdLaunchExitedDuringWait,
  helixdReadinessWaitCommand,
  parseHelixdReadinessWaitOutput
} from './helixd-remote-readiness-wait'
import type { HelixdHostTransport } from '../../ssh/helixd-host-transport'
import { errorMessage } from '../../../shared/error-message'
import {
  execCommand,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import {
  currentHelixdFence,
  isHelixdFenceLost,
  HelixdFenceLostError,
  posixHelixdFenceGuard
} from '../activation/helixd-activation-fence-scope'
import { helixdWindowsHomeOpCommand } from './helixd-remote-windows-node'
import { HELIXD_WINDOWS_FENCE_ARG } from '../host-state/helixd-windows-host-fence-ops'
import { isWindowsRemoteHost, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

// Pause even after early host answers to avoid a tight retry loop.
const READINESS_RETRY_PAUSE_MS = 1_000

export type HelixdRemoteExecTarget = {
  conn: HelixdHostTransport
  host: RemoteHostPlatform
  signal?: AbortSignal
  /** Locates the runtime store for host-record scripts; required on Windows, unused elsewhere. */
  remoteHome?: string
}

/** A held activation fence must still name this run before any host step. */
export async function execHelixdRemote(
  target: HelixdRemoteExecTarget,
  command: string,
  signal = target.signal
): Promise<string> {
  const fence = currentHelixdFence()
  const run = (line: string): Promise<string> =>
    execCommand(target.conn, line, {
      wrapCommand: target.host.commandDialect !== 'powershell',
      signal
    })
  try {
    if (!fence) {
      return await run(command)
    }
    if (!isWindowsRemoteHost(target.host)) {
      return await run(`${posixHelixdFenceGuard(fence)} ${command}`)
    }
    // Host ops check ownership internally; other commands need a preceding check.
    if (!command.includes(HELIXD_WINDOWS_FENCE_ARG) && target.remoteHome) {
      await run(helixdWindowsHomeOpCommand(target.host, target.remoteHome, 'fence-check', []))
    }
    return await run(command)
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    throw isHelixdFenceLost(error) ? new HelixdFenceLostError() : error
  }
}

/** Only confirmed failures use fallback; unconfirmed failures and lost fences propagate. */
export function execHelixdRemoteOr(
  target: HelixdRemoteExecTarget,
  command: string,
  fallback = ''
): Promise<string> {
  return execHelixdRemote(target, command).catch((error: unknown) => {
    if (isUnconfirmedSshCommandTermination(error) || error instanceof HelixdFenceLostError) {
      throw error
    }
    return fallback
  })
}

/** Recovery paths must finish even when the request that started them was cancelled. */
export function withoutAbortSignal<T extends { signal?: AbortSignal }>(
  options: T
): Omit<T, 'signal'> {
  const { signal: _signal, ...rest } = options
  return rest
}

export async function launchHelixdAndAwaitReadiness(
  target: HelixdRemoteExecTarget & {
    readinessTimeoutMs?: number
    sleep?: (ms: number) => Promise<void>
  },
  spec: HelixdLaunchSpec
): Promise<HelixdReadinessParse> {
  if (isWindowsRemoteHost(target.host)) {
    const slotAnswer = await execHelixdRemote(
      target,
      windowsHelixdLaunchRuntimeCommand(target.host, spec.remoteInstallDir)
    )
    const slotRuntime = readWindowsHelixdSlotRuntime(slotAnswer)
    const slotEntry = readWindowsHelixdSlotEntry(slotAnswer, target.host, spec.remoteInstallDir)
    readWindowsHelixdLaunchReport(
      await execHelixdRemote(
        target,
        windowsHelixdLaunchCommand(target.host, spec, slotRuntime, slotEntry)
      )
    )
  } else {
    await execHelixdRemote(
      target,
      helixdLaunchCommand(
        target.host,
        spec,
        target.conn.helixdLaunchDetach ?? 'nohup',
        (await target.conn.helixdLaunchEnv?.()) ?? []
      )
    )
  }
  const deadline = Date.now() + (target.readinessTimeoutMs ?? HELIXD_STARTUP_READINESS_TIMEOUT_MS)
  const sleep = target.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  let last = parseHelixdReadinessOutput('')
  let lastWaitError: unknown
  // Always read once, even if client scheduling outlasted the deadline.
  for (let first = true; first || Date.now() < deadline; first = false) {
    target.signal?.throwIfAborted()
    const waitSeconds = Math.min(
      HELIXD_READINESS_WAIT_MAX_SECONDS,
      Math.ceil((deadline - Date.now()) / 1000)
    )
    let output: string
    try {
      output = await execHelixdRemote(
        target,
        helixdReadinessWaitCommand(target.host, spec.remoteInstallDir, waitSeconds)
      )
    } catch (error) {
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        isUnconfirmedSshCommandTermination(error) ||
        error instanceof HelixdFenceLostError
      ) {
        throw error
      }
      // Failed reads do not prove launch failure; stopping here could kill a healthy candidate.
      lastWaitError = error
      console.warn(`[helixd] readiness wait failed; retrying: ${errorMessage(error)}`)
      await sleep(READINESS_RETRY_PAUSE_MS)
      continue
    }
    target.signal?.throwIfAborted()
    lastWaitError = undefined
    last = parseHelixdReadinessWaitOutput(target.host, output)
    // An exited launch answers as the deadline would, so callers attach the same log tail.
    if (last.state !== 'pending' || helixdLaunchExitedDuringWait(target.host, output)) {
      return last
    }
    await sleep(READINESS_RETRY_PAUSE_MS)
  }
  if (lastWaitError !== undefined) {
    throw lastWaitError
  }
  return last
}
