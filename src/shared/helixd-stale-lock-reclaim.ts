/** Explicit lock recovery for cases automatic startup cannot judge, such as shared-home reboot.
 * Dependency-free so clients, CLI and launcher share the command/result. */
import { quotePosixShellUnlessPlain } from './shell-argument-quoting'

export const HELIXD_RECLAIM_STALE_LOCK_FLAG = '--reclaim-stale-lock'
export const HELIXD_STALE_LOCK_DATA_ROOT_FLAG = '--data-root'
/** Pin confirmation to dry-run evidence. Clients probe this flag in bundles; reclaim alone cannot confirm safely. */
export const HELIXD_STALE_LOCK_EXPECT_NONCE_FLAG = '--expect-nonce'

/** `--json` prints one of these; the exit code names the status too. */
export type HelixdStaleLockReclaimStatus = 'none' | 'eligible' | 'refused' | 'reclaimed'

export type HelixdStaleLockEvidence = {
  pid: number
  host: string
  bootId: string
  currentBootId: string
  ageMinutes: number
  /** The record's own nonce, for `--expect-nonce`; absent from builds before the pin. */
  nonce?: string
}

// Why `none` is not 0: a command pointed at the wrong data root must never read as a recovery.
export const HELIXD_STALE_LOCK_RECLAIM_EXIT_CODES: Record<HelixdStaleLockReclaimStatus, number> = {
  reclaimed: 0,
  refused: 1,
  eligible: 2,
  none: 4
}

/** Managed hosts lack helix/helixd on PATH, so pasteable hints must name the holder’s runtime, entry and data root. */
export type HelixdReclaimHintRuntime = { execPath: string; entry: string | undefined }

export function helixdStaleLockReclaimCommand(
  dataRoot: string,
  runtime: HelixdReclaimHintRuntime | null
): string {
  const program = runtime?.entry
    ? `${quotePosixShellUnlessPlain(runtime.execPath)} ${quotePosixShellUnlessPlain(runtime.entry)}`
    : 'helix serve'
  return `${program} ${HELIXD_RECLAIM_STALE_LOCK_FLAG} ${HELIXD_STALE_LOCK_DATA_ROOT_FLAG} ${quotePosixShellUnlessPlain(dataRoot)}`
}
