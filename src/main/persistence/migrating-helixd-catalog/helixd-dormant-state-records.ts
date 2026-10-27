import type {
  HelixdMigrationDormantStatePayload,
  HelixdMigrationManifest
} from '../../../shared/helixd-migration/helixd-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { SparsePreset } from '../../../shared/worktree/create-types'
import type { WorkspaceLineage, WorktreeLineage } from '../../../shared/worktree/lineage-types'
import type { WorktreeMeta } from '../../../shared/worktree/meta-types'
import { omitDefaultWorktreeMetaFields } from '../../../shared/worktree/meta-persisted-defaults'
import { assertHelixdDestinationCanonicalMetadata } from './helixd-destination-worktree-metadata'
import { assertSameValue } from './helixd-catalog-row-identity'
import {
  mergeRetiredNameRegistries,
  type RetiredNameRegistry
} from '../../../shared/worktree/retired-name-registry'
import { recordRetirementNamespaceRegistry } from '../../worktree-retirement-namespace'
import {
  applyPreparedHelixdMigrationWorkspaceSession,
  prepareHelixdMigrationWorkspaceSession,
  type PreparedHelixdMigrationWorkspaceSession
} from './helixd-destination-workspace-session'
import {
  applyPreparedHelixdMigrationAutomationState,
  prepareHelixdMigrationAutomationState,
  type PreparedHelixdMigrationAutomationState
} from './helixd-destination-automation-state'
import {
  applyPreparedHelixdMigrationClientState,
  prepareHelixdMigrationClientState,
  type PreparedHelixdMigrationClientState
} from './helixd-destination-client-state'

type KeyedRow<T> = { key: string; value: T }
type RegistryUpdate = { key: string; value: RetiredNameRegistry }

export type PreparedHelixdMigrationDormantState = {
  payload: HelixdMigrationDormantStatePayload | undefined
  newWorktreeMeta: KeyedRow<WorktreeMeta>[]
  newWorktreeLineage: KeyedRow<WorktreeLineage>[]
  newWorkspaceLineage: KeyedRow<WorkspaceLineage>[]
  newSparsePresets: SparsePreset[]
  retiredNameUpdates: RegistryUpdate[]
  retirementNamespaceUpdates: RegistryUpdate[]
  workspaceSession: PreparedHelixdMigrationWorkspaceSession
  automationState: PreparedHelixdMigrationAutomationState
  clientState: PreparedHelixdMigrationClientState
}

export function prepareHelixdMigrationDormantState(
  manifest: HelixdMigrationManifest,
  state: PersistedState
): PreparedHelixdMigrationDormantState {
  const payload = manifest.payload.dormantState
  if (!payload) {
    return emptyPreparedDormantState()
  }
  assertHelixdDestinationCanonicalMetadata(state, payload.worktreeMeta)
  const worktreeMeta = payload.worktreeMeta.map((entry) => ({
    key: entry.worktreeId,
    value: structuredClone(entry.meta)
  }))
  const worktreeLineage = payload.worktreeLineage.map((entry) => ({
    key: entry.worktreeId,
    value: structuredClone(entry.lineage)
  }))
  const workspaceLineage = payload.workspaceLineage.map((entry) => ({
    key: entry.childWorkspaceKey,
    value: structuredClone(entry.lineage)
  }))
  const existingPresets = new Map(
    Object.values(state.sparsePresetsByRepo)
      .flat()
      .map((preset) => [sparsePresetKey(preset), preset])
  )
  const newSparsePresets = payload.sparsePresets.filter((preset) => {
    const existing = existingPresets.get(sparsePresetKey(preset))
    if (!existing) {
      return true
    }
    assertSameValue(existing, preset, `sparse_preset:${preset.repoId}:${preset.id}`)
    return false
  })
  return {
    payload,
    newWorktreeMeta: selectNewKeyedRows(
      worktreeMeta,
      state.worktreeMeta,
      'worktree_meta',
      omitDefaultWorktreeMetaFields
    ),
    newWorktreeLineage: selectNewKeyedRows(
      worktreeLineage,
      state.worktreeLineageById,
      'worktree_lineage'
    ),
    newWorkspaceLineage: selectNewKeyedRows(
      workspaceLineage,
      state.workspaceLineageByChildKey,
      'workspace_lineage'
    ),
    newSparsePresets,
    retiredNameUpdates: payload.retiredWorktreeNames.map((entry) => ({
      key: entry.repoId,
      value: mergeRetiredNameRegistries(
        state.retiredWorktreeNamesByRepo?.[entry.repoId] ?? { exhaustedTiers: 0, names: [] },
        entry.registry
      )
    })),
    retirementNamespaceUpdates: payload.retiredWorktreeNamespaces.map((entry) => ({
      key: entry.namespaceKey,
      value: mergeRetiredNameRegistries(
        state.retiredWorktreeNamesByNamespace?.[entry.namespaceKey] ?? {
          exhaustedTiers: 0,
          names: []
        },
        entry.registry
      )
    })),
    workspaceSession: prepareHelixdMigrationWorkspaceSession(payload.workspaceSession, state),
    automationState: prepareHelixdMigrationAutomationState(
      payload.automations,
      payload.automationRuns,
      state
    ),
    clientState: prepareHelixdMigrationClientState(payload.clientState, state)
  }
}

export function applyPreparedHelixdMigrationDormantState(
  prepared: PreparedHelixdMigrationDormantState,
  state: PersistedState
): void {
  for (const entry of prepared.newWorktreeMeta) {
    state.worktreeMeta[entry.key] = entry.value
  }
  for (const entry of prepared.newWorktreeLineage) {
    state.worktreeLineageById[entry.key] = entry.value
  }
  for (const entry of prepared.newWorkspaceLineage) {
    state.workspaceLineageByChildKey[entry.key] = entry.value
  }
  for (const preset of prepared.newSparsePresets) {
    state.sparsePresetsByRepo[preset.repoId] = [
      ...(state.sparsePresetsByRepo[preset.repoId] ?? []),
      preset
    ]
  }
  if (prepared.retiredNameUpdates.length > 0) {
    state.retiredWorktreeNamesByRepo ??= {}
    for (const entry of prepared.retiredNameUpdates) {
      state.retiredWorktreeNamesByRepo[entry.key] = entry.value
    }
  }
  if (prepared.retirementNamespaceUpdates.length > 0) {
    state.retiredWorktreeNamesByNamespace ??= {}
    for (const entry of prepared.retirementNamespaceUpdates) {
      recordRetirementNamespaceRegistry(
        state.retiredWorktreeNamesByNamespace,
        entry.key,
        entry.value
      )
    }
  }
  applyPreparedHelixdMigrationWorkspaceSession(prepared.workspaceSession, state)
  applyPreparedHelixdMigrationAutomationState(prepared.automationState, state)
  applyPreparedHelixdMigrationClientState(prepared.clientState, state)
}

function selectNewKeyedRows<T>(
  incoming: KeyedRow<T>[],
  existing: Record<string, T>,
  label: string,
  canonicalize: (value: T) => T = (value) => value
): KeyedRow<T>[] {
  return incoming.filter((entry) => {
    const current = existing[entry.key]
    if (current === undefined) {
      return true
    }
    assertSameValue(canonicalize(current), canonicalize(entry.value), `${label}:${entry.key}`)
    return false
  })
}

const sparsePresetKey = (preset: Pick<SparsePreset, 'id' | 'repoId'>): string =>
  `${preset.repoId}\0${preset.id}`

function emptyPreparedDormantState(): PreparedHelixdMigrationDormantState {
  return {
    payload: undefined,
    newWorktreeMeta: [],
    newWorktreeLineage: [],
    newWorkspaceLineage: [],
    newSparsePresets: [],
    retiredNameUpdates: [],
    retirementNamespaceUpdates: [],
    workspaceSession: { incoming: undefined, merged: undefined },
    automationState: {
      incomingAutomations: [],
      incomingRuns: [],
      newAutomations: [],
      newRuns: []
    },
    clientState: {
      incoming: undefined,
      mobileSelections: {},
      uiRouting: undefined
    }
  }
}
