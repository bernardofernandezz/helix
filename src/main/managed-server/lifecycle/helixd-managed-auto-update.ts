import {
  planManagedHelixdAutoUpdate,
  type ManagedHelixdAutoUpdateSkip
} from './helixd-managed-update-decision'
import { materializeHelixdArtifact } from '../../helixd/helixd-artifact-materializer'
import {
  HelixdArtifactsUnavailableError,
  HelixdHostUnsupportedError
} from '../../helixd/helixd-host-unavailable'
import { findIncompleteManagedHelixdMigration } from './helixd-managed-migration-status'
import { HELIXD_ACTIVATION_FENCE_BUSY_CODE } from '../activation/helixd-activation-fence-hold'
import { resolveLinkedHelixdContext } from './helixd-managed-runtime-context'
import {
  runManagedHelixdUpdate,
  withManagedHelixdLifecycle
} from '../../ssh/helixd-runtime-maintenance'
import type { HelixdUpdateDeferCode } from '../../ssh/helixd-update-plan'
import { readLocalFullVersion } from '../install/remote-versioned-install'

export type ManagedHelixdAutoUpdateOutcome =
  | { outcome: 'skipped'; reason: ManagedHelixdAutoUpdateSkip }
  | { outcome: 'updated'; activeVersion: string }
  | { outcome: 'deferred'; code: string; reason: string }
  /** Candidate rejection or update failure; consult host state before assuming the incumbent serves. */
  | { outcome: 'failed'; reason: string }

const WAITING_CODES: ReadonlySet<string> = new Set<
  HelixdUpdateDeferCode | typeof HELIXD_ACTIVATION_FENCE_BUSY_CODE
>([
  HELIXD_ACTIVATION_FENCE_BUSY_CODE,
  'helixd_update_terminals_running',
  'helixd_update_terminal_census_unavailable',
  'helixd_update_strands_live_terminals',
  'helixd_update_daemon_protocol_unverifiable',
  'helixd_update_ends_in_process_terminals'
])

/** Temporary deferrals retry on later connects; interrupted activations require recovery. */
export function isWaitingHelixdUpdateDeferral(code: string): boolean {
  return WAITING_CODES.has(code)
}

export function autoUpdateManagedHelixdEnvironment(
  userDataPath: string,
  args: {
    environmentId: string
    appVersion: string
    /** Read under the lifecycle lock to observe prior overlapping attempts. */
    failedBefore: () => boolean
    onUpdating: () => void
  }
): Promise<ManagedHelixdAutoUpdateOutcome> {
  return withManagedHelixdLifecycle(userDataPath, args.environmentId, async (managed) => {
    // Restarting during migration would race cutover staging.
    if (findIncompleteManagedHelixdMigration(userDataPath, managed.environment.id)) {
      return { outcome: 'skipped', reason: 'migrating' }
    }
    const context = await resolveLinkedHelixdContext(managed.environment, managed.deployment)
    const candidateVersion = await bundledManagedHelixdVersion(context.serverTarget)
    const plan = planManagedHelixdAutoUpdate({
      record: context.activationRecord,
      candidateVersion,
      appVersion: args.appVersion,
      failedBefore: args.failedBefore()
    })
    if (plan.action === 'skip') {
      return { outcome: 'skipped', reason: plan.reason }
    }
    args.onUpdating()
    let lockedSkip: ManagedHelixdAutoUpdateSkip | null = null
    try {
      const result = await runManagedHelixdUpdate(userDataPath, managed, context, {
        // Another desktop may activate or stop a newer build during upload; recheck under the fence.
        admitRecord: (record) => {
          const locked = planManagedHelixdAutoUpdate({
            record,
            candidateVersion,
            appVersion: args.appVersion,
            failedBefore: false
          })
          if (locked.action === 'update') {
            return null
          }
          lockedSkip = locked.reason
          return `Auto-update skipped under the host fence: ${locked.reason}.`
        }
      })
      if (lockedSkip) {
        return { outcome: 'skipped', reason: lockedSkip }
      }
      if (result.outcome !== 'deferred') {
        return { outcome: 'updated', activeVersion: result.activeVersion }
      }
      return isWaitingHelixdUpdateDeferral(result.code)
        ? { outcome: 'deferred', code: result.code, reason: result.reason }
        : { outcome: 'failed', reason: result.reason }
    } catch (error) {
      return { outcome: 'failed', reason: error instanceof Error ? error.message : String(error) }
    }
  })
}

type HelixdTarget = Parameters<typeof materializeHelixdArtifact>[0]

// Packaged templates cannot change during this session; avoid repeated hashing.
const bundledVersions = new Map<HelixdTarget, Promise<string | null>>()

/** This build's helixd version for `target`; null when the build bundles none for it. */
export function bundledManagedHelixdVersion(target: HelixdTarget): Promise<string | null> {
  let version = bundledVersions.get(target)
  if (!version) {
    version = materializeHelixdArtifact(target).then(readLocalFullVersion, (error: unknown) => {
      if (
        error instanceof HelixdHostUnsupportedError ||
        error instanceof HelixdArtifactsUnavailableError
      ) {
        return null
      }
      throw error
    })
    // A transient local failure must not stick for the session.
    version.catch(() => bundledVersions.delete(target))
    bundledVersions.set(target, version)
  }
  return version
}

export function resetBundledHelixdVersionsForTests(): void {
  bundledVersions.clear()
}
