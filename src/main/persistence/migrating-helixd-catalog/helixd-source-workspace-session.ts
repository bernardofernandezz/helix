import type {
  HelixdMigrationCatalogPayload,
  HelixdMigrationManifestSource
} from '../../../shared/helixd-migration/helixd-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import type { HelixdMigrationTerminalScrollbackSnapshot } from '../../../shared/helixd-migration/helixd-migration-scrollback'
import {
  extractSessionOwnersForTransfer,
  hasTransferredSessionState
} from '../../helix-profiles/profile-session-owner-transfer'
import type { TerminalScrollbackSnapshotStorage } from '../../terminal-scrollback-snapshots'
import {
  createHelixdMigrationSourceScope,
  helixdMigrationOwnerMatchesScope,
  helixdMigrationPartitionScope,
  unqualifyHelixdMigrationOwnerKey
} from './helixd-source-scope'
import {
  collectUnsupportedSessionItems,
  projectDormantSessionFocus,
  projectSessionToDestination,
  isUnsavedDraftItem,
  transferableSleepingAgentSession,
  worktreeLabel
} from './helixd-source-workspace-session-eligibility'
import { withoutLeftBehindSessionRows } from './helixd-source-left-behind-session-rows'
import {
  collectOwnedTerminalTabIds,
  dropHelixdMigrationTerminalBindings
} from './helixd-source-workspace-session-layout'
import { mergeSessionFragments } from './helixd-source-workspace-session-fragments'
import {
  desktopDrafts,
  resolveCopiesForHost,
  type SessionFragment
} from './helixd-source-session-copy-resolution'
import { withoutHelixdMigrationDrafts } from './helixd-source-draft-rename'
import { hasClosedTerminalTabRecord } from '../../../shared/closed-terminal-tab-tombstones'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import { normalizeWorkspaceSessionKeyToWorkspaceId } from '../../../shared/workspace-scope'
import { helixdMigrationSessionPartitions } from './helixd-source-session-partitions'
import { collectDuplicateHelixdMigrationSessionIdentities } from './helixd-source-duplicate-session-identities'
import {
  hasDuplicateHelixdMigrationScrollbackDescriptors,
  projectHelixdMigrationSessionScrollback
} from './helixd-source-scrollback-state'

export type HelixdMigrationSourceWorkspaceSessionInspection = {
  payload: WorkspaceSessionState | undefined
  snapshots: HelixdMigrationTerminalScrollbackSnapshot[]
  /** Blocker names and remedies. */
  blockedItems: string[]
  /** Retained on this desktop after confirmed "Move anyway". */
  leftBehindItems: string[]
}

const UNREADABLE_SESSION = 'saved tabs Helix could not read'

/** Unrecognized session shapes block the move rather than failing connection. */
export function collectHelixdMigrationSourceWorkspaceSession(
  state: PersistedState,
  source: HelixdMigrationManifestSource,
  catalog: HelixdMigrationCatalogPayload,
  storage?: TerminalScrollbackSnapshotStorage,
  leaveBehind = false
): HelixdMigrationSourceWorkspaceSessionInspection {
  let collected: HelixdMigrationSourceWorkspaceSessionInspection
  try {
    collected = collectWorkspaceSession(state, source, catalog, storage, leaveBehind)
  } catch (error) {
    console.warn('[migration] Unreadable workspace session blocks the move:', error)
    collected = {
      payload: undefined,
      snapshots: [],
      blockedItems: [UNREADABLE_SESSION],
      leftBehindItems: []
    }
  }
  if (!leaveBehind || collected.blockedItems.length === 0) {
    return collected
  }
  // "Move anyway" can retain sessions, but desktop drafts would lose their copy and must still block.
  const drafts = desktopDrafts(state, source, catalog)
  return drafts.length > 0 || collected.blockedItems.includes(UNREADABLE_SESSION)
    ? { ...collected, blockedItems: drafts.length > 0 ? drafts : collected.blockedItems }
    : {
        payload: undefined,
        snapshots: [],
        blockedItems: [],
        leftBehindItems: [...collected.leftBehindItems, ...collected.blockedItems]
      }
}

function collectWorkspaceSession(
  state: PersistedState,
  source: HelixdMigrationManifestSource,
  catalog: HelixdMigrationCatalogPayload,
  storage: TerminalScrollbackSnapshotStorage | undefined,
  leaveBehind: boolean
): HelixdMigrationSourceWorkspaceSessionInspection {
  const sourceScope = createHelixdMigrationSourceScope({ source, catalog, repos: state.repos })
  const fragments: SessionFragment[] = []
  const blockedItems: string[] = []
  const leftBehindItems: string[] = []
  const partitions = helixdMigrationSessionPartitions(state, sourceScope).map(
    ([partitionId, saved]) => {
      const scope = helixdMigrationPartitionScope(sourceScope, partitionId)
      // Only host-partition rows retain a copy after the move; desktop drafts cannot stay behind.
      const session = withoutLeftBehindSessionRows(saved, scope, leaveBehind, {
        leaveDrafts: partitionId !== LOCAL_EXECUTION_HOST_ID
      })
      return {
        saved,
        session,
        scope,
        terminalTabIds: collectOwnedTerminalTabIds(session, scope)
      }
    }
  )
  const sourceTerminalTabIds = new Set(
    partitions.flatMap(({ terminalTabIds }) => [...terminalTabIds])
  )
  for (const { saved, session, scope, terminalTabIds } of partitions) {
    const sourceHostPartition = scope.partitionHostId === scope.hostId
    const unsupported = collectUnsupportedSessionItems(
      session,
      scope,
      sourceHostPartition,
      terminalTabIds,
      sourceTerminalTabIds
    )
    if (leaveBehind) {
      // Retained rows no longer block, but unsaved desktop drafts still do.
      const kept = new Set(unsupported.filter(isUnsavedDraftItem))
      blockedItems.push(...kept)
      leftBehindItems.push(
        ...collectUnsupportedSessionItems(
          withoutLeftBehindSessionRows(saved, scope),
          scope,
          sourceHostPartition,
          terminalTabIds,
          sourceTerminalTabIds
        ).filter((item) => !kept.has(item))
      )
    } else {
      blockedItems.push(...unsupported)
    }
    const fragment = extractSessionOwnersForTransfer(session, {
      mapOwnerKey: (ownerKey) =>
        helixdMigrationOwnerMatchesScope(ownerKey, scope)
          ? unqualifyHelixdMigrationOwnerKey(ownerKey)
          : null,
      mapWorktreeId: unqualifyHelixdMigrationOwnerKey,
      projectSessionFocus: sourceHostPartition
        ? ({ source, transferred, terminalTabIds }) =>
            projectDormantSessionFocus(source, transferred, scope, terminalTabIds)
        : undefined,
      projectSleepingAgentSession: (record) =>
        transferableSleepingAgentSession(record, session, scope, terminalTabIds)
          ? {
              ...structuredClone(record),
              worktreeId: unqualifyHelixdMigrationOwnerKey(record.worktreeId),
              connectionId: null
            }
          : null
    })
    if (!sourceHostPartition) {
      // Global client focus does not belong on the destination host.
      fragment.activeWorktreeId = null
      delete fragment.activeWorkspaceKey
    }
    dropHelixdMigrationTerminalBindings(fragment)
    if (hasTransferredSessionState(fragment)) {
      const projected = projectHelixdMigrationSessionScrollback(
        projectSessionToDestination(fragment, scope),
        storage,
        leaveBehind
      )
      blockedItems.push(...projected.blockedItems)
      leftBehindItems.push(...projected.leftBehindItems)
      fragments.push({
        session: projected.session,
        snapshots: projected.snapshots,
        local: scope.partitionHostId === LOCAL_EXECUTION_HOST_ID,
        sourceHost: sourceHostPartition
      })
    }
  }
  if (blockedItems.length > 0 || fragments.length === 0) {
    return { payload: undefined, snapshots: [], blockedItems, leftBehindItems }
  }
  const closedTabIds = new Set(
    partitions.flatMap(({ session }) =>
      Object.keys(session.closedTerminalTabTombstonesByTabId ?? {}).filter((tabId) =>
        hasClosedTerminalTabRecord(session.closedTerminalTabTombstonesByTabId, tabId)
      )
    )
  )
  let merged = mergeSessionFragments(
    fragments.map((fragment) => fragment.session),
    closedTabIds
  )
  let moving = fragments
  if (!merged.session && leaveBehind) {
    // Prefer the host copy as the app does, while preserving desktop drafts.
    const conflicting = new Set(merged.conflicts.map(normalizeWorkspaceSessionKeyToWorkspaceId))
    const resolved = resolveCopiesForHost(fragments, conflicting)
    if (resolved.clashingDrafts.length > 0) {
      return {
        payload: undefined,
        snapshots: [],
        blockedItems: resolved.clashingDrafts,
        leftBehindItems
      }
    }
    leftBehindItems.push(
      ...merged.conflicts.map(
        (ownerKey) => `this desktop's other copy of the tabs in ${worktreeLabel(ownerKey)}`
      )
    )
    moving = resolved.fragments
    merged = mergeSessionFragments(
      moving.map((fragment) => fragment.session),
      closedTabIds
    )
  }
  const snapshots = moving.flatMap((fragment) => fragment.snapshots)
  if (merged.session && hasDuplicateHelixdMigrationScrollbackDescriptors(snapshots)) {
    return {
      payload: undefined,
      snapshots: [],
      blockedItems: ['terminal history saved twice for one pane'],
      leftBehindItems
    }
  }
  const duplicates = merged.session
    ? collectDuplicateHelixdMigrationSessionIdentities(merged.session)
    : []
  if (duplicates.length > 0) {
    return { payload: undefined, snapshots: [], blockedItems: duplicates, leftBehindItems }
  }
  // Keep draft contents desktop-side; commit retargets their records to the server.
  return merged.session
    ? {
        payload: withoutHelixdMigrationDrafts(merged.session),
        snapshots,
        blockedItems: [],
        leftBehindItems
      }
    : {
        payload: undefined,
        snapshots: [],
        blockedItems: merged.conflicts.map(
          (ownerKey) => `two different saved copies of the tabs in ${worktreeLabel(ownerKey)}`
        ),
        leftBehindItems
      }
}
