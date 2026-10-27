import type {
  HelixdMigrationClientStatePayload,
  HelixdMigrationUiRoutingState
} from '../../../shared/helixd-migration/helixd-migration-client-state'
import type {
  HelixdMigrationCatalogPayload,
  HelixdMigrationManifestSource
} from '../../../shared/helixd-migration/helixd-migration-manifest'
import type {
  PersistedMobileClientTabSelection,
  PersistedState
} from '../../../shared/persisted-state-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import { sessionPartitions } from './helixd-source-workspace-session-fragments'
import { collectCloseIntents } from './helixd-source-client-browser-intents'
import {
  createHelixdMigrationSourceScope,
  helixdMigrationOwnerMatchesScope,
  helixdMigrationOwnsRepoId,
  unqualifyHelixdMigrationOwnerKey
} from './helixd-source-scope'
import { paneBelongsToTabs } from '../../../shared/workspace-session-pane-ownership'

export type HelixdMigrationSourceClientStateInspection = {
  payload: HelixdMigrationClientStatePayload | undefined
  /** Duplicate closes are folded into the existing workspace-session blocker. */
  blockedCount: number
  /** Presentation state that cannot move stays behind. */
  blockedCounts: { 'saved-port-forward': number }
}

export function collectHelixdMigrationSourceClientState(
  state: PersistedState,
  source: HelixdMigrationManifestSource,
  catalog: HelixdMigrationCatalogPayload,
  destinationEnvironmentId: string | undefined,
  eligibleSession: WorkspaceSessionState | undefined
): HelixdMigrationSourceClientStateInspection {
  const scope = createHelixdMigrationSourceScope({ source, catalog, repos: state.repos })
  const blockedCounts = { 'saved-port-forward': 0 }
  let blockedCount = 0
  const mobile = collectMobileSelections(state, scope, eligibleSession)
  const uiRouting = collectUiRouting(state, scope, eligibleSession)
  const target = state.sshTargets.find((entry) => entry.id === scope.targetId)
  const savedPortForwards = target?.portForwards ? structuredClone(target.portForwards) : undefined
  if (savedPortForwards) {
    const ports = new Set<number>()
    for (const forward of savedPortForwards) {
      if (ports.has(forward.localPort)) {
        blockedCounts['saved-port-forward'] += 1
      }
      ports.add(forward.localPort)
    }
  }
  const closeIntents = collectCloseIntents(
    state,
    scope,
    destinationEnvironmentId,
    eligibleSession,
    () => {
      blockedCount += 1
    }
  )
  const clientState: HelixdMigrationClientStatePayload = {
    ...(mobile && Object.keys(mobile).length > 0
      ? { mobileClientTabSelectionsByDeviceId: mobile }
      : {}),
    ...(uiRouting && Object.keys(uiRouting).length > 0 ? { uiRouting } : {}),
    ...(savedPortForwards && savedPortForwards.length > 0 ? { savedPortForwards } : {}),
    ...(closeIntents && closeIntents.length > 0
      ? { clientHostedBrowserCloseIntents: closeIntents }
      : {})
  }
  return {
    payload: Object.keys(clientState).length > 0 ? clientState : undefined,
    blockedCount,
    blockedCounts
  }
}

function collectMobileSelections(
  state: PersistedState,
  scope: ReturnType<typeof createHelixdMigrationSourceScope>,
  session: WorkspaceSessionState | undefined
):
  | NonNullable<HelixdMigrationClientStatePayload['mobileClientTabSelectionsByDeviceId']>
  | undefined {
  const eligible = session ? collectEligibleSessionIdentity(session, scope) : null
  const result: NonNullable<
    HelixdMigrationClientStatePayload['mobileClientTabSelectionsByDeviceId']
  > = {}
  const destinationKeys = new Set<string>()
  for (const [deviceId, selections] of Object.entries(
    state.mobileClientTabSelectionsByDeviceId ?? {}
  )) {
    const projected: Record<string, PersistedMobileClientTabSelection> = {}
    for (const [ownerKey, selection] of Object.entries(selections)) {
      if (!helixdMigrationOwnerMatchesScope(ownerKey, scope)) {
        continue
      }
      const destinationKey = unqualifyHelixdMigrationOwnerKey(ownerKey)
      const representable = representableMobileSelection(selection, eligible)
      if (!representable || destinationKeys.has(`${deviceId}\0${destinationKey}`)) {
        continue
      }
      destinationKeys.add(`${deviceId}\0${destinationKey}`)
      projected[destinationKey] = representable
    }
    if (Object.keys(projected).length > 0) {
      result[deviceId] = projected
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function collectUiRouting(
  state: PersistedState,
  scope: ReturnType<typeof createHelixdMigrationSourceScope>,
  session: WorkspaceSessionState | undefined
): HelixdMigrationUiRoutingState | undefined {
  const ui = state.ui
  const result: HelixdMigrationUiRoutingState = {}
  if (ui.lastActiveRepoId && helixdMigrationOwnsRepoId(scope, ui.lastActiveRepoId)) {
    result.lastActiveRepoId = ui.lastActiveRepoId
  }
  if (ui.lastActiveWorktreeId && helixdMigrationOwnerMatchesScope(ui.lastActiveWorktreeId, scope)) {
    result.lastActiveWorktreeId = unqualifyHelixdMigrationOwnerKey(ui.lastActiveWorktreeId)
  }
  const dotfiles = Object.entries(ui.showDotfilesByWorktree ?? {})
    .filter(([ownerKey]) => helixdMigrationOwnerMatchesScope(ownerKey, scope))
    .map(([ownerKey, enabled]) => [unqualifyHelixdMigrationOwnerKey(ownerKey), enabled] as const)
  if (dotfiles.length > 0) {
    result.showDotfilesByWorktree = Object.fromEntries(dotfiles)
  }
  const dismissed = (ui.setupScriptPromptDismissedRepoIds ?? []).filter((repoId) =>
    helixdMigrationOwnsRepoId(scope, repoId)
  )
  if (dismissed.length > 0) {
    result.setupScriptPromptDismissedRepoIds = dismissed
  }
  const manualOrder = (ui.manualRepoOrder ?? [])
    .filter((entry) => entry.hostId === scope.hostId && scope.repoIds.has(entry.repoId))
    .map((entry) => ({ hostId: 'local' as const, repoId: entry.repoId }))
  if (manualOrder.length > 0) {
    result.manualRepoOrder = manualOrder
  }
  // Sidebar filters belong to this desktop's window.
  const eligible = session ? collectEligibleSessionIdentity(session, scope) : null
  const sourceTabIds = collectSourceOwnedTabIds(state, scope)
  const acknowledgements = Object.entries(ui.acknowledgedAgentsByPaneKey ?? {}).filter(
    ([paneKey]) => {
      return (
        paneBelongsToTabs(paneKey, sourceTabIds) &&
        eligible !== null &&
        paneBelongsToTabs(paneKey, eligible.tabIds)
      )
    }
  )
  if (acknowledgements.length > 0) {
    result.acknowledgedAgentsByPaneKey = Object.fromEntries(acknowledgements)
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** Include source-owned tabs from every partition. */
function collectSourceOwnedTabIds(
  state: PersistedState,
  scope: ReturnType<typeof createHelixdMigrationSourceScope>
): Set<string> {
  const tabIds = new Set<string>()
  for (const [hostId, session] of sessionPartitions(state, 'local')) {
    for (const [ownerKey, tabs] of Object.entries(session.tabsByWorktree ?? {})) {
      if (hostId === scope.hostId || helixdMigrationOwnerMatchesScope(ownerKey, scope)) {
        tabs.forEach((tab) => tabIds.add(tab.id))
      }
    }
  }
  return tabIds
}

type EligibleSessionIdentity = { tabIds: ReadonlySet<string>; groupIds: ReadonlySet<string> }

function collectEligibleSessionIdentity(
  session: WorkspaceSessionState,
  scope: ReturnType<typeof createHelixdMigrationSourceScope>
): EligibleSessionIdentity {
  const tabIds = new Set<string>()
  const groupIds = new Set<string>()
  for (const [ownerKey, tabs] of Object.entries(session.tabsByWorktree ?? {})) {
    if (!helixdMigrationOwnerMatchesScope(ownerKey, scope)) {
      continue
    }
    tabs.forEach((tab) => tabIds.add(tab.id))
  }
  for (const [ownerKey, tabs] of Object.entries(session.unifiedTabs ?? {})) {
    if (helixdMigrationOwnerMatchesScope(ownerKey, scope)) {
      tabs.forEach((tab) => tabIds.add(tab.id))
    }
  }
  for (const [ownerKey, groups] of Object.entries(session.tabGroups ?? {})) {
    if (!helixdMigrationOwnerMatchesScope(ownerKey, scope)) {
      continue
    }
    groups.forEach((group) => groupIds.add(group.id))
  }
  return { tabIds, groupIds }
}

/** Mobile terminal selections name panes: tabId::leafId. */
function movedMobileTab(id: string, tabIds: ReadonlySet<string>): boolean {
  const separator = id.indexOf('::')
  return tabIds.has(id) || (separator !== -1 && tabIds.has(id.slice(0, separator)))
}

/** Drop references to tabs/groups that did not move; null when none remain. */
function representableMobileSelection(
  selection: PersistedMobileClientTabSelection,
  eligible: EligibleSessionIdentity | null
): PersistedMobileClientTabSelection | null {
  const tabIds = eligible?.tabIds ?? new Set<string>()
  const groupIds = eligible?.groupIds ?? new Set<string>()
  const recentTabIds = selection.recentTabIds?.filter((tabId) => tabIds.has(tabId)) ?? []
  const next: PersistedMobileClientTabSelection = {
    activeTabId:
      selection.activeTabId !== null && movedMobileTab(selection.activeTabId, tabIds)
        ? selection.activeTabId
        : null,
    activeGroupId:
      selection.activeGroupId !== null && groupIds.has(selection.activeGroupId)
        ? selection.activeGroupId
        : null,
    activeTabIdByGroupId: Object.fromEntries(
      Object.entries(selection.activeTabIdByGroupId).filter(
        ([groupId, tabId]) => groupIds.has(groupId) && tabIds.has(tabId)
      )
    ),
    ...(recentTabIds.length > 0 ? { recentTabIds } : {})
  }
  return next.activeTabId === null &&
    next.activeGroupId === null &&
    Object.keys(next.activeTabIdByGroupId).length === 0
    ? null
    : next
}
