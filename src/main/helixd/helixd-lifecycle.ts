import { setRuntimeBrowserCommandsFactory } from '../runtime/runtime-browser-commands-factory'
import { setDesktopBrowserBridgeHostEnabled } from '../runtime/desktop-browser-bridge/desktop-browser-bridge-registry'
import { HELIXD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/helixd-managed-launch-env'
import { startHelixdBrowserProvider } from './helixd-browser-startup'
import { HelixdRuntimeLifetime, type HelixdRuntimeCleanup } from './helixd-runtime-lifetime'
import type { HelixdManagedStopInstance } from '../../shared/helixd-stop-request'
import { acquireHelixdInstanceLock } from './helixd-instance-lock'
import { HELIXD_BUNDLED_LAUNCHER_ENV } from './helixd-bundled-runtime'
import { resolveHelixdExitCode } from './helixd-exit-code'
import { recordAgentSessionRuntimeEnd } from '../runtime/agent-session-runtime-end-record'
import { HELIXD_SHUTDOWN_DEADLINE_MS } from './helixd-stop-deadlines'
import { holdHelixdTerminalAdmissionUntilExit } from './helixd-stop-terminal-admission'
import {
  acquireProfileStateRuntimeAdmission,
  type ProfileStateRuntimeAdmission
} from '../persistence/profile-state/profile-state-access'

const bundledLauncherChannel = process.env[HELIXD_BUNDLED_LAUNCHER_ENV] === '1'
delete process.env[HELIXD_BUNDLED_LAUNCHER_ENV]

function createIdempotentHelixdCleanup(cleanup: () => Promise<void>): () => Promise<void> {
  let completion: Promise<void> | null = null
  return () => {
    completion ??= Promise.resolve().then(cleanup)
    return completion
  }
}

/** Return whether this caller owns the stop; fatal faults supply a nonzero completed-stop code. */
export type HelixdShutdownTrigger = (
  reason: string,
  onFailed?: () => void,
  stoppedExitCode?: number
) => boolean

/** Deduplicate launcher/child signals into one bounded stop; onFailed retracts clean-stop records. */
export function installHelixdShutdownSignals(
  stop: () => Promise<void>,
  deadlineMs = HELIXD_SHUTDOWN_DEADLINE_MS
): HelixdShutdownTrigger {
  let stopping = false
  let exitCode = 0
  let failed = false
  let retractClean: (() => void) | undefined
  const markFailed = (): void => {
    if (!failed) {
      failed = true
      retractClean?.()
    }
  }
  const shutdown: HelixdShutdownTrigger = (signal, onFailed, stoppedExitCode = 0) => {
    if (stopping) {
      // Fatal faults must escalate an in-progress clean stop to failure.
      if (stoppedExitCode !== 0 && exitCode === 0) {
        exitCode = stoppedExitCode
        onFailed?.()
        markFailed()
      }
      return false
    }
    stopping = true
    holdHelixdTerminalAdmissionUntilExit()
    exitCode = stoppedExitCode
    retractClean = onFailed
    setTimeout(() => {
      console.error(`helixd: shutdown after ${signal} exceeded ${deadlineMs}ms — exiting`)
      markFailed()
      process.exit(1)
    }, deadlineMs)
    stop()
      .then(() => process.exit(exitCode))
      .catch((error) => {
        console.error(`helixd: shutdown after ${signal} failed:`, error)
        markFailed()
        process.exit(resolveHelixdExitCode(error))
      })
    return true
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  // Survive terminal hangups; INT/TERM request graceful shutdown.
  if (process.platform !== 'win32') {
    process.on('SIGHUP', () => {})
  }
  if (bundledLauncherChannel && typeof process.send === 'function') {
    process.once('disconnect', () => shutdown('launcher disconnect'))
    if (!process.connected) {
      shutdown('launcher disconnect')
    }
  }
  return shutdown
}

export async function stopHelixdStructuredAgentSessions(): Promise<void> {
  const { stopStructuredAgentSessionRuntime } =
    await import('../runtime/structured-agent-session-runtime')
  await stopStructuredAgentSessionRuntime({ trigger: 'quit' })
}

export async function startHelixdWithLifecycle<T extends object>(
  start: (registerRuntimeCleanup: (cleanup: HelixdRuntimeCleanup) => void) => Promise<T>,
  cleanupHost: (runtimeCleanupSucceeded: boolean) => Promise<void>
): Promise<T & { stop(): Promise<void> }> {
  const runtime = new HelixdRuntimeLifetime()
  const cleanup = createIdempotentHelixdCleanup(async () => {
    // Stamp quit before awaiting teardown so dying chat agents read as restart rather than crash.
    recordAgentSessionRuntimeEnd('quit')
    let runtimeCleanupSucceeded = false
    try {
      await runtime.stop()
      runtimeCleanupSucceeded = true
    } finally {
      await cleanupHost(runtimeCleanupSucceeded)
    }
  })
  try {
    const handle = await start((nextCleanup) => runtime.add(nextCleanup))
    return { ...handle, stop: cleanup }
  } catch (error) {
    try {
      await cleanup()
    } catch (cleanupError) {
      // Preserve the startup fault while recording cleanup failures.
      console.error('[helixd] startup cleanup failed:', cleanupError)
    }
    throw error
  }
}

/** Keep profile admission/lock until all runtime writers stop. */
export async function startHelixdWithHost<T extends object>(
  userDataPath: string,
  start: (registerCleanup: (cleanup: HelixdRuntimeCleanup) => void) => Promise<T>,
  runQuitHandlers: () => void
): Promise<T & { stop(): Promise<void>; instance: HelixdManagedStopInstance }> {
  const instanceLock = acquireHelixdInstanceLock(userDataPath)
  const { pid, startedAtMs, nonce } = instanceLock.record
  const instance = { pid, startedAtMs, nonce, lockPath: instanceLock.path }
  let admission: ProfileStateRuntimeAdmission | undefined
  let browserProvider: ReturnType<typeof startHelixdBrowserProvider> | undefined
  return startHelixdWithLifecycle(
    async (registerCleanup) => {
      admission = acquireProfileStateRuntimeAdmission(userDataPath)
      // Browser authorization UI must not block RPC readiness.
      browserProvider = startHelixdBrowserProvider({ userDataPath })
      // Only managed hosts have opted-in desktop bridges; user-started hosts route to paired page hosts.
      setDesktopBrowserBridgeHostEnabled(Boolean(process.env[HELIXD_MANAGED_ACTIVATION_ROOT_ENV]))
      return { ...(await start(registerCleanup)), instance }
    },
    async (runtimeCleanupSucceeded) => {
      // Failed cleanup retains both ownership fences until process exit.
      const host = new HelixdRuntimeLifetime(() => {
        if (runtimeCleanupSucceeded) {
          instanceLock.release()
        }
      })
      host.add(({ failed }) => {
        if (runtimeCleanupSucceeded && !failed) {
          admission?.release()
        }
      })
      host.add(() => runQuitHandlers())
      host.add(() => setRuntimeBrowserCommandsFactory(null))
      host.add(() => setDesktopBrowserBridgeHostEnabled(false))
      host.add(() => browserProvider?.stop())
      await host.stop()
    }
  )
}

export async function flushHelixdProfileStoreForShutdown(
  store: { flushFinalOrThrowAsync(): Promise<void>; freezeWritesAsync(): Promise<void> },
  paneGrids?: { flushPaneGrids(): Promise<void> | null } | null
): Promise<void> {
  // A pane's grid still inside its write burst joins the final save.
  const flushing = paneGrids?.flushPaneGrids()
  if (flushing) {
    await flushing
  }
  try {
    await store.flushFinalOrThrowAsync()
  } finally {
    await store.freezeWritesAsync()
  }
}
