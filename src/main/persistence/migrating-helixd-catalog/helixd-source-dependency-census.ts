import type { HelixdMigrationManifest } from '../../../shared/helixd-migration/helixd-migration-manifest'
import {
  HELIXD_MIGRATION_DEPENDENCY_KINDS,
  type HelixdMigrationDependencyKind
} from '../../../shared/helixd-migration/helixd-migration-preflight'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { TerminalScrollbackSnapshotStorage } from '../../terminal-scrollback-snapshots'
import {
  inspectHelixdMigrationSourceSessions,
  type HelixdMigrationSourceSessionInspection
} from './helixd-source-session-dependencies'
import {
  collectHelixdMigrationSourceDormantState,
  helixdMigrationLeavesBehind
} from './helixd-source-dormant-state'
import {
  createHelixdMigrationSourceScope,
  helixdMigrationOwnerMatchesScope,
  helixdMigrationPartitionScope,
  type HelixdMigrationSourceScope
} from './helixd-source-scope'
import { paneBelongsToTabs } from '../../../shared/workspace-session-pane-ownership'

export type HelixdMigrationSourceDependencyCensus = {
  totalCount: number
  counts: Record<HelixdMigrationDependencyKind, number>
  /** Blocker names and remedies where available. */
  names?: Partial<Record<HelixdMigrationDependencyKind, string[]>>
}

export function collectHelixdMigrationUntransferredDependencyCensus(
  state: PersistedState,
  manifest: HelixdMigrationManifest,
  storage?: TerminalScrollbackSnapshotStorage
): HelixdMigrationSourceDependencyCensus {
  const scope = createHelixdMigrationSourceScope({
    source: manifest.source,
    catalog: manifest.payload,
    repos: state.repos
  })
  const sessions = inspectHelixdMigrationSourceSessions(state, {
    hostId: scope.hostId,
    ownerMatches: (ownerKey, partitionHostId) =>
      helixdMigrationOwnerMatchesScope(
        ownerKey,
        helixdMigrationPartitionScope(scope, partitionHostId)
      )
  })
  const dormant = collectHelixdMigrationSourceDormantState(
    state,
    manifest.source,
    manifest.payload,
    storage,
    manifest.destinationEnvironmentId
  )
  const counts: Record<HelixdMigrationDependencyKind, number> = {
    ...dormant.blockedCounts,
    'terminal-lease': state.sshRemotePtyLeases.filter(
      (lease) => lease.targetId === scope.targetId && lease.state !== 'terminated'
    ).length,
    // Retained recoveries can stay behind; the terminal gate still requires exit.
    'terminal-recovery': helixdMigrationLeavesBehind(state, scope.targetId)
      ? 0
      : countTerminalRecoveryState(state, scope, sessions)
  }
  return {
    counts,
    totalCount: HELIXD_MIGRATION_DEPENDENCY_KINDS.reduce((total, kind) => total + counts[kind], 0),
    names:
      dormant.blockedSessionItems.length > 0
        ? { 'workspace-session': dormant.blockedSessionItems }
        : {}
  }
}

// The terminal gate proves recovery leases exited; hook aliases add no independent terminal ownership.
function countTerminalRecoveryState(
  state: PersistedState,
  scope: HelixdMigrationSourceScope,
  sessions: HelixdMigrationSourceSessionInspection
): number {
  return state.migrationUnsupportedPtyEntries.filter(
    (entry) =>
      helixdMigrationOwnerMatchesScope(entry.worktreeId, scope) ||
      (entry.tabId ? sessions.tabIds.has(entry.tabId) : false) ||
      sessions.ptyIds.has(entry.ptyId) ||
      (entry.paneKey ? paneBelongsToTabs(entry.paneKey, sessions.tabIds) : false)
  ).length
}
