// Retain journal and fence until one serving slot is proven; release removes both, while only recovery may take retained state over.
import { randomUUID } from 'node:crypto'
import {
  execHelixdRemote,
  withoutAbortSignal,
  type HelixdRemoteExecTarget
} from '../install/helixd-remote-runtime-control'
import { isUnconfirmedSshCommandTermination } from '../../ssh/remote-exec/remote-exec-command'
import { acquireInstallLock, RemoteInstallLockBusyError } from '../install/remote-install-lock'
import {
  orphanInstallLockCommand,
  probeInstallLockExistsCommand
} from '../install/remote-install-lock-commands'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import {
  HELIXD_FENCE_OWNER_FILENAME,
  posixHelixdFenceOwnedTest,
  runWithHelixdFence,
  type HelixdFence
} from './helixd-activation-fence-scope'
import {
  helixdRemoteBaseDir,
  helixdWindowsHomeOpCommand
} from '../install/helixd-remote-windows-node'
import { forgetHeldHelixdFence, rememberHeldHelixdFence } from '../../ssh/helixd-held-fence-tokens'
import { exitedOwnLockProof } from '../../ssh/helixd-exited-own-lock'
import { isWindowsRemoteHost } from '../../ssh/ssh-remote-platform'
import {
  helixdActivationFenceLockDir,
  helixdActivationTransactionPath,
  helixdActivationTransactionRoot
} from './helixd-activation-transaction'
import {
  readHelixdActivationTransaction,
  writeHelixdActivationTransaction
} from './helixd-activation-transaction-store'

const HELIXD_ACTIVATION_MAX_READINESS_TIMEOUT_MS = 5 * 60_000

export type HelixdActivationLockOptions = HelixdRemoteExecTarget & { remoteHome: string }

export type HelixdActivationLockControl = {
  /** Retain on throw once a journal describes possibly changed host state. */
  retainOnError(): void
  /** Retain on success too when serving-slot ownership remains unproven. */
  retain(): void
  /** Release even on later throw once the recorded slot is proven restored. */
  recovered(): void
}

/** Bound readiness below the stale-lock window so live waiters do not look abandoned. */
export function resolveHelixdActivationReadinessTimeout(
  configured: number | undefined,
  fallback: number
): number {
  const timeout = configured ?? fallback
  if (
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    timeout > HELIXD_ACTIVATION_MAX_READINESS_TIMEOUT_MS
  ) {
    throw new Error(
      `helixd readiness timeout must be an integer from 1 to ${HELIXD_ACTIVATION_MAX_READINESS_TIMEOUT_MS}ms`
    )
  }
  return timeout
}

// Tolerate brief concurrent work without stalling the lifecycle queue for a full stale window.
const HELIXD_ACTIVATION_FENCE_WAIT_MS = 5_000

/** Report held after a brief wait; token identifies this generation for subsequent recovery proof. */
export async function withHelixdActivationLock<T>(
  options: HelixdActivationLockOptions,
  run: (control: HelixdActivationLockControl) => Promise<T>,
  held: () => T | Promise<T>,
  token: string = randomUUID()
): Promise<T> {
  const lockRoot = helixdActivationTransactionRoot(options.host, options.remoteHome)
  rememberHeldHelixdFence(token)
  try {
    await acquireInstallLock(options.conn, lockRoot, options.host, {
      signal: options.signal,
      relayGcClaim: false,
      // Unresolved state ownership cannot become safe through age alone.
      allowStaleTakeover: false,
      waitTimeoutMs: HELIXD_ACTIVATION_FENCE_WAIT_MS,
      owner: { fileName: HELIXD_FENCE_OWNER_FILENAME, token }
    })
  } catch (error) {
    if (error instanceof RemoteInstallLockBusyError) {
      forgetHeldHelixdFence(token)
      return await held()
    }
    throw error
  }
  const fence = activationFence(options, token)
  let retainOnError = false
  let retain = false
  try {
    const result = await runWithHelixdFence(fence, () =>
      run({
        retainOnError: () => {
          retainOnError = true
        },
        retain: () => {
          retain = true
        },
        recovered: () => {
          retainOnError = false
        }
      })
    )
    await (retain ? orphanRetainedFence(options, fence) : releaseActivationFence(options, fence))
    return result
  } catch (error) {
    // Unconfirmed host work may still mutate state, so do not age its fence.
    if (!isUnconfirmedSshCommandTermination(error)) {
      await (
        retainOnError ? orphanRetainedFence(options, fence) : releaseActivationFence(options, fence)
      ).catch((releaseError: unknown) => {
        console.warn(
          `[helixd] Failed to release activation lock after an error: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`
        )
      })
    }
    throw error
  }
}

/** Recover stale, previous-boot or proven exited-own fences; a fresh live owner remains busy. */
export async function withStaleHelixdActivationRecoveryLock<T>(
  options: HelixdActivationLockOptions,
  run: (control: Pick<HelixdActivationLockControl, 'retain'>) => Promise<T>
): Promise<T> {
  const lockRoot = helixdActivationTransactionRoot(options.host, options.remoteHome)
  const token = randomUUID()
  rememberHeldHelixdFence(token)
  // Takeover replaces the token so the predecessor can neither act nor release.
  await acquireInstallLock(options.conn, lockRoot, options.host, {
    signal: options.signal,
    relayGcClaim: false,
    allowStaleTakeover: true,
    waitTimeoutMs: 0,
    owner: { fileName: HELIXD_FENCE_OWNER_FILENAME, token },
    exitedOwner: exitedOwnLockProof(options, {
      baseDir: helixdRemoteBaseDir(options.host, options.remoteHome),
      guardsStateMutation: true
    })
  }).catch((error: unknown) => {
    if (error instanceof RemoteInstallLockBusyError) {
      forgetHeldHelixdFence(token)
    }
    throw error
  })
  const fence = activationFence(options, token)
  let retain = false
  let result: T
  try {
    result = await runWithHelixdFence(fence, async () => {
      await adoptInterruptedJournal(options)
      return run({ retain: () => (retain = true) })
    })
  } catch (error) {
    // Failed recovery retains ownership fencing until one serving slot is proven.
    if (!isUnconfirmedSshCommandTermination(error)) {
      await orphanRetainedFence(options, fence).catch(() => undefined)
    }
    throw error
  }
  await (retain ? orphanRetainedFence(options, fence) : releaseActivationFence(options, fence))
  return result
}

/** Adopt the journal into this generation so release recognizes it as owned. */
async function adoptInterruptedJournal(options: HelixdActivationLockOptions): Promise<void> {
  const journal = await readHelixdActivationTransaction(options).catch(() => null)
  if (journal) {
    await writeHelixdActivationTransaction(options, journal)
  }
}

function activationFence(options: HelixdActivationLockOptions, token: string): HelixdFence {
  return { lockDir: helixdActivationFenceLockDir(options.host, options.remoteHome), token }
}

/** Age retained, finished work for immediate recovery; token guards prevent aging a successor's fence. */
async function orphanRetainedFence(
  options: HelixdActivationLockOptions,
  fence: HelixdFence
): Promise<void> {
  try {
    await runWithHelixdFence(fence, () =>
      execHelixdRemote(
        withoutAbortSignal(options),
        orphanInstallLockCommand(options.host, fence.lockDir)
      )
    )
    forgetHeldHelixdFence(fence.token)
  } catch (error) {
    // Failed orphan marking keeps the fence held until its normal stale window expires.
    console.warn(
      `[helixd] Could not mark a retained activation fence as ownerless: ${String(error)}`
    )
  }
}

/** Failed probes throw; unreadable must never mean unfenced. */
export async function helixdActivationFenceExists(
  options: HelixdActivationLockOptions
): Promise<boolean> {
  const lockDir = helixdActivationFenceLockDir(options.host, options.remoteHome)
  const answer = (
    await execHelixdRemote(options, probeInstallLockExistsCommand(options.host, lockDir))
  ).trim()
  if (answer !== 'LOCKED' && answer !== 'OPEN') {
    throw new Error('The activation fence probe returned no verifiable answer.')
  }
  return answer === 'LOCKED'
}

export function releaseHelixdActivationFence(
  options: HelixdActivationLockOptions,
  token: string
): Promise<void> {
  return releaseActivationFence(options, activationFence(options, token))
}

/** Remove only this generation: journal first, then rename the owned lock aside before deletion. */
async function releaseActivationFence(
  options: HelixdActivationLockOptions,
  fence: HelixdFence
): Promise<void> {
  const lockRoot = helixdActivationTransactionRoot(options.host, options.remoteHome)
  const journal = helixdActivationTransactionPath(options.host, options.remoteHome)
  // Cancellation must not prevent releasing a fence already proven unnecessary.
  const target = withoutAbortSignal(options)
  const command = isWindowsRemoteHost(options.host)
    ? helixdWindowsHomeOpCommand(options.host, options.remoteHome, 'fence-release', [
        fence.lockDir,
        journal,
        fence.token
      ])
    : posixReleaseFenceCommand(fence, journal, lockRoot)
  const answer = (await execHelixdRemote(target, command)).trim()
  forgetHeldHelixdFence(fence.token)
  if (answer.endsWith('SUPERSEDED')) {
    console.warn('[helixd] A newer run had taken this activation fence over; it was left in place.')
  }
}

/** Rename then check ownership, restoring foreign entries so stalled release cannot delete a successor's state. */
export function posixReleaseFenceCommand(
  fence: HelixdFence,
  journal: string,
  lockRoot: string
): string {
  const lock = quotePosixShell(fence.lockDir)
  const journalPath = quotePosixShell(journal)
  const stamp = quotePosixShell(journalFenceStamp(fence.token))
  return [
    `${posixHelixdFenceOwnedTest(fence)} || { echo SUPERSEDED; exit 0; };`,
    `ja=${journalPath}.release.$$;`,
    `if mv ${journalPath} "$ja" 2>/dev/null; then`,
    `grep -qF ${stamp} "$ja" || mv -n "$ja" ${journalPath} 2>/dev/null; rm -f "$ja"; fi;`,
    `la=${lock}.released.$$;`,
    `if mv ${lock} "$la" 2>/dev/null; then`,
    `if [ "$(cat "$la"/${HELIXD_FENCE_OWNER_FILENAME} 2>/dev/null)" = ${quotePosixShell(fence.token)} ]; then rm -rf "$la";`,
    `else mv -n "$la" ${lock} 2>/dev/null; fi; fi;`,
    `rmdir ${quotePosixShell(lockRoot)} 2>/dev/null; echo RELEASED`
  ].join(' ')
}

function journalFenceStamp(token: string): string {
  return `"fenceToken": ${JSON.stringify(token)}`
}
