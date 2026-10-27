import type { PublicKnownRuntimeEnvironment } from './runtime-environments'
import type { HelixdTerminalCensus } from './helixd-terminal-census'
import type { HelixdMigrationBlocker } from './helixd-migration/helixd-migration-preflight'
import type { HelixdMigrationSourceCutoverPhase } from './helixd-migration/helixd-migration-source-cutover'
import type { HelixdDaemonRetirementVerdict } from './helixd-stop-request'
import type { SshManagedServerLinkedProject } from './ssh-types'
import type { HelixdStaleLockEvidence } from './helixd-stale-lock-reclaim'

export const HELIXD_MANAGED_REMOTE_PORT = 6_768

/** Refused because terminals are, or may be, still running on the host. */
export type HelixdManagedRefusal = {
  outcome: 'refused'
  verdict: 'live' | 'unverifiable'
  code: string
  reason: string
  /** Only saved state blocks, which a confirmed "Move anyway" leaves on this desktop. */
  canLeaveBehind?: true
}

export type HelixdManagedDeferral = {
  outcome: 'deferred'
  candidateVersion: string
  code: string
  reason: string
  /** False when force cannot make the rejected lifecycle transition safe. */
  forceable?: boolean
}

/** The one deferral Update anyway may pass: counted terminals the daemon carries across. */
export const HELIXD_UPDATE_TERMINALS_RUNNING_CODE = 'helixd_update_terminals_running'

/** Update anyway passes counted live-terminal deferrals, preserves version admission, and requires the confirmed incumbent build. */
export type HelixdManagedPastLiveTerminals = { incumbentVersion: string | null }

export type HelixdManagedDeployResult =
  | {
      outcome: 'created' | 'updated' | 'already-current'
      environment: PublicKnownRuntimeEnvironment
      activeVersion: string
    }
  | HelixdManagedDeferral

export type HelixdManagedRollbackResult =
  | {
      outcome: 'rolled-back'
      environment: PublicKnownRuntimeEnvironment
      activeVersion: string
      discarded: string[]
    }
  | { outcome: 'refused' | 'failed'; code: string; reason: string }

/** A recovery that needs the operator to accept restoring a snapshot over changed state. */
export const HELIXD_RECOVERY_CHANGED_STATE_CODE = 'helixd_recovery_changed_state'

export type HelixdManagedRecoveryResult =
  | { outcome: 'none' }
  | { outcome: 'pending'; code: string; reason: string }
  | {
      outcome: 'recovered'
      resolution: 'committed' | 'restored-incumbent'
      activeVersion: string | null
      environment: PublicKnownRuntimeEnvironment
    }
  | HelixdManagedRefusal

/** Only a proven `exited` unlinks the server locally; anything less keeps it linked. */
export type HelixdManagedStopResult =
  | {
      outcome: 'unlinked'
      verdict: 'exited'
      environmentId: string
      sshTargetId: string
      stoppedVersion: string | null
      retirement: HelixdDaemonRetirementVerdict | null
    }
  | HelixdManagedRefusal

/** Refuse restart with live or unverifiable terminals: the daemon outlives helixd and retains its inherited environment. */
export type HelixdManagedRestartResult =
  | { outcome: 'restarted'; environmentId: string }
  | { outcome: 'terminals-running'; liveSessions: number | null }
  | { outcome: 'not-restarted'; reason: string }

/** A dry run, or a confirmation pinned to the lock record that dry run showed. */
export type HelixdManagedStaleLockReclaimRequest =
  | { yes: false }
  | { yes: true; expectNonce: string }

/** `helixd --reclaim-stale-lock` run on a managed host's active slot. */
export type HelixdManagedStaleLockReclaimResult =
  | {
      status: 'none' | 'eligible' | 'refused'
      message: string
      lockPath: string
      evidence?: HelixdStaleLockEvidence
    }
  /** `notRestarted` says why the server did not start again once its lock was cleared. */
  | {
      status: 'reclaimed'
      environmentId: string
      message: string
      lockPath: string
      /** The record the reclaim acted on. */
      evidence?: HelixdStaleLockEvidence
      notRestarted?: string
    }
  /** No remote reclaim occurred. reclaimWithoutPin requires manual reclaim because the host cannot pin confirmation;
   * otherwise lockPath names the lock to delete manually. */
  | { status: 'unsupported'; message: string; lockPath?: string; reclaimWithoutPin?: true }
  /** The slot runs the command but gave no answer this client understands; nothing is known. */
  | { status: 'no-answer'; message: string }
  /** Another lifecycle step holds the host; nothing changed. */
  | { status: 'busy'; message: string }

/** Forget only unlinks this desktop; an unreachable server may still run, so its verdict remains unverifiable. */
export type HelixdManagedForgetResult =
  | {
      outcome: 'forgotten'
      verdict: 'unverifiable'
      environmentId: string
      sshTargetId: string
    }
  | HelixdManagedRefusal

export type HelixdManagedCancelStopResult =
  | { outcome: 'none' }
  /** The stop was withdrawn before helixd acted on it; the server keeps serving. */
  | { outcome: 'canceled'; activeVersion: string }
  /** helixd had already exited; finish with stop to unlink the server. */
  | { outcome: 'already-stopped' }
  | HelixdManagedRefusal

export type HelixdManagedRuntimeStatus = {
  environmentId: string
  sshTargetId: string
  activeVersion: string | null
  previousVersion: string | null
  activatedAt: string | null
  rollbackAvailable: boolean
  recovery:
    | {
        operation: 'activate'
        phase: 'prepared' | 'incumbent-stopped' | 'snapshot-captured' | 'candidate-ready'
        version: string
        startedAt: string
      }
    | {
        operation: 'rollback'
        phase:
          | 'prepared'
          | 'incumbent-stopped'
          | 'rescue-captured'
          | 'rollback-state-restored'
          | 'target-ready'
        version: string
        startedAt: string
      }
    | {
        operation: 'decommission'
        phase: 'prepared' | 'stop-dispatched' | 'process-exited'
        version: string
        startedAt: string
      }
    | null
  /** Terminals the daemon runs; `null` counts are unverifiable and block updates and stops. */
  terminals: HelixdTerminalCensus
  /** An unfinished dormant migration into this server; a rollback is refused while it runs. */
  migration: {
    migrationId: string
    phase: HelixdMigrationSourceCutoverPhase
    startedAt: string
  } | null
  /** The last update this client deferred for this server, cleared once one goes through. */
  deferredUpdate: (HelixdManagedDeferral & { deferredAt: string }) | null
  /** The Helix release that activated `activeVersion`; absent when unknown or from older desktops. */
  activeAppVersion?: string | null
  /** This desktop's bundled build when Update would move the host to it; absent from older desktops. */
  availableUpdate?: string | null
}

export type HelixdManagedConversionResult =
  | {
      /** Committed on the server and retired from the SSH host. */
      outcome: 'converted'
      environment: PublicKnownRuntimeEnvironment
      migrationId: string
      /** Projects the server already held, so this desktop's own state for them did not move. */
      linkedProjects?: SshManagedServerLinkedProject[]
    }
  | HelixdManagedDeferral
  | HelixdManagedRefusal

export type HelixdManagedPendingMigrationRow = {
  migrationId: string
  environmentId: string
  name: string
  sshTargetId: string
  phase: HelixdMigrationSourceCutoverPhase
  startedAt: string
}

export type HelixdDeltaMoveRow = {
  kind: 'repository' | 'folder-workspace' | 'project-group'
  id: string
  label: string
}

/** What moving a host's newer projects would add, and what the server will keep as it is. */
export type HelixdDeltaMovePreview = {
  sshTargetId: string
  environmentId: string
  added: HelixdDeltaMoveRow[]
  /** Projects an older build changed or removed; the server keeps its own copy of these. */
  notReflected: { edited: HelixdDeltaMoveRow[]; removed: HelixdDeltaMoveRow[] }
  blockers: HelixdMigrationBlocker[]
}

export type HelixdDeltaMoveResult =
  | { outcome: 'moved'; migrationId: string }
  | { outcome: 'refused'; code: string; reason: string; blockers?: HelixdMigrationBlocker[] }
