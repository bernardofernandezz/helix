// Resumed stale holders must prove their generation on-host before every step, preventing writes or release under a successor's fence.
import { AsyncLocalStorage } from 'node:async_hooks'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { isSshCommandExitError } from '../../ssh/remote-exec/remote-exec-command'

export const HELIXD_FENCE_OWNER_FILENAME = '.helix-fence-owner'
export const HELIXD_FENCE_LOST_MARKER = '__HELIXD_FENCE_LOST__'
/** EX_TEMPFAIL: this superseded generation cannot retry its step. */
export const HELIXD_FENCE_LOST_EXIT = 75

export type HelixdFence = { lockDir: string; token: string }

const scope = new AsyncLocalStorage<HelixdFence>()

export function runWithHelixdFence<T>(fence: HelixdFence, run: () => Promise<T>): Promise<T> {
  return scope.run(fence, run)
}

export function currentHelixdFence(): HelixdFence | null {
  return scope.getStore() ?? null
}

export class HelixdFenceLostError extends Error {
  constructor() {
    super(
      "This run's activation fence was taken over by another run, so it stopped before changing the host."
    )
    this.name = 'HelixdFenceLostError'
  }
}

export function posixHelixdFenceOwnedTest(fence: HelixdFence): string {
  const owner = quotePosixShell(
    `${fence.lockDir.replace(/\/+$/u, '')}/${HELIXD_FENCE_OWNER_FILENAME}`
  )
  return `[ "$(cat ${owner} 2>/dev/null)" = ${quotePosixShell(fence.token)} ]`
}

export function posixHelixdFenceGuard(fence: HelixdFence): string {
  return `${posixHelixdFenceOwnedTest(fence)} || { echo ${HELIXD_FENCE_LOST_MARKER}; exit ${HELIXD_FENCE_LOST_EXIT}; };`
}

/** Use exit status and stdout; error messages quote commands containing the marker even when no guard failed. */
export function isHelixdFenceLost(error: unknown): boolean {
  if (!isSshCommandExitError(error)) {
    return false
  }
  // `powershell -Command` reports any nonzero native exit as 1.
  const exited = error.exitCode === HELIXD_FENCE_LOST_EXIT || error.exitCode === 1
  return exited && error.stdout.trim().split(/\r?\n/u).at(-1) === HELIXD_FENCE_LOST_MARKER
}
