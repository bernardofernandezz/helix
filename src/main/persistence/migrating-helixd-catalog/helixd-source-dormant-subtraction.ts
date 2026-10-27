import type { HelixdMigrationManifest } from '../../../shared/helixd-migration/helixd-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { subtractHelixdSourceWorktreeMetadata } from './helixd-source-worktree-metadata'
import { subtractHelixdMigrationSourceAutomationState } from './helixd-source-automation-subtraction'
import { subtractHelixdMigrationSourceWorkspaceSession } from './helixd-source-workspace-session-subtraction'
import { subtractHelixdMigrationClientState } from './helixd-source-client-subtraction'

/** Mutate a delta-view copy only. */
export function subtractHelixdMigrationSourceDormantState(
  state: PersistedState,
  manifest: HelixdMigrationManifest
): void {
  // Include state a downgraded build added even when the manifest had none.
  subtractHelixdSourceWorktreeMetadata(state, manifest)
  subtractHelixdMigrationSourceAutomationState(state, manifest)
  const dormant = manifest.payload.dormantState
  if (!dormant) {
    return
  }
  dormant.worktreeLineage.forEach((entry) => delete state.worktreeLineageById[entry.sourceKey])
  dormant.workspaceLineage.forEach(
    (entry) => delete state.workspaceLineageByChildKey[entry.sourceKey]
  )
  for (const preset of dormant.sparsePresets) {
    const remaining = (state.sparsePresetsByRepo[preset.repoId] ?? []).filter(
      (entry) => entry.id !== preset.id
    )
    if (remaining.length > 0) {
      state.sparsePresetsByRepo[preset.repoId] = remaining
    } else {
      delete state.sparsePresetsByRepo[preset.repoId]
    }
  }
  for (const entry of dormant.retiredWorktreeNames) {
    delete state.retiredWorktreeNamesByRepo?.[entry.repoId]
  }
  subtractHelixdMigrationSourceWorkspaceSession(state, manifest)
  subtractHelixdMigrationClientState(state, manifest)
  // Retain snapshot files: the prior durable profile and rollback evidence can still reference them.
}
