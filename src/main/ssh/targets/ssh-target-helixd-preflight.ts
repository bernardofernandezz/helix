/** Read-only export preflight: catalog rows and representable dormant state can migrate; ownership, live leases and untransferred dependencies block. */
import { isLiveSshPtyLease } from '../../../shared/ssh-types'
import type { Store } from '../../persistence'
import type {
  HelixdMigrationBlocker,
  HelixdMigrationPreflight
} from '../../../shared/helixd-migration/helixd-migration-preflight'
import {
  createHelixdMigrationManifest,
  type HelixdMigrationExportStore
} from '../helixd-migration-manifest-export'
import {
  collectTargetCatalogBlockers,
  resolveHelixdPreflightTarget
} from './ssh-target-helixd-claims'
import { collectUntransferredDependentBlockers } from './ssh-target-helixd-dependents'
import {
  preservesHelixdMigrationBridgedPanes,
  type HelixdMigrationPaneLeasePredicate
} from '../helixd-migration-bridged-panes'

export type HelixdMigrationPreflightStore = HelixdMigrationExportStore &
  Pick<
    Store,
    'getSshTarget' | 'getSshRemotePtyLeases' | 'inspectHelixdMigrationUntransferredDependencies'
  >

/** `owner` passes the environment's own fence only when its migration journal is on disk. */
export function preflightHelixdMigrationExport(
  store: HelixdMigrationPreflightStore,
  targetId: string,
  owner?: { environmentId: string; recorded: boolean },
  /** COMPAT(legacy-relay-bridge): leases a bridged proof left running for the bridge. */
  bridgedPtyIds: readonly string[] = []
): HelixdMigrationPreflight {
  const resolved = resolveHelixdPreflightTarget(store, targetId, owner)
  if ('result' in resolved) {
    return resolved.result
  }
  const { target } = resolved
  const blockers: HelixdMigrationBlocker[] = [...collectTargetCatalogBlockers(store, target)]
  const terminalLeases = store
    .getSshRemotePtyLeases(targetId)
    .filter((lease) => isLiveSshPtyLease(lease) && !bridgedPtyIds.includes(lease.ptyId))
    .map(({ ptyId, worktreeId, tabId, leafId, state, updatedAt }) => ({
      ptyId,
      worktreeId,
      tabId,
      leafId,
      state,
      updatedAt
    }))
  if (terminalLeases.length > 0) {
    // A relay PTY cannot move to helixd; its work must finish first.
    blockers.push({
      code: 'helixd_migration_direct_ssh_terminal_leases',
      category: 'live-or-unverifiable',
      terminalLeases
    })
  }
  blockers.push(
    ...collectUntransferredDependentBlockers(store, createHelixdMigrationManifest(store, target))
  )
  return {
    targetId,
    targetLabel: target.label,
    claimable: !blockers.some(isBlockingHelixdMigrationBlocker),
    blockers
  }
}

/** Confirmed Move anyway can leave saved state, but desktop drafts that cannot be left still block. */
export function leaveBehindClearsHelixdMigrationBlockers(
  store: HelixdMigrationPreflightStore & Pick<Store, 'createHelixdMigrationLeaveBehindView'>,
  targetId: string,
  bridgedPtyIds: readonly string[] = [],
  isBridgedPaneLease?: HelixdMigrationPaneLeasePredicate
): boolean {
  const view = store.createHelixdMigrationLeaveBehindView(targetId)
  const preflight = preflightHelixdMigrationExport(
    {
      ...view,
      getSshTarget: (id) => store.getSshTarget(id),
      getSshRemotePtyLeases: (id) => store.getSshRemotePtyLeases(id)
    },
    targetId,
    undefined,
    bridgedPtyIds
  )
  const target = store.getSshTarget(targetId)
  return (
    preflight.claimable &&
    target !== undefined &&
    preservesHelixdMigrationBridgedPanes(
      createHelixdMigrationManifest(view, target).payload,
      store.getSshRemotePtyLeases(targetId),
      bridgedPtyIds,
      isBridgedPaneLease
    )
  )
}

/** Only saved state blocks: a confirmed "Move anyway" may leave it on this desktop. */
export function onlyLeavableHelixdMigrationBlockers(
  blockers: readonly HelixdMigrationBlocker[]
): boolean {
  const blocking = blockers.filter(isBlockingHelixdMigrationBlocker)
  return (
    blocking.length > 0 &&
    blocking.every((blocker) => blocker.code === 'helixd_migration_dependent_state')
  )
}

export function isBlockingHelixdMigrationBlocker(blocker: HelixdMigrationBlocker): boolean {
  return (
    blocker.category !== 'drainable-static-state' &&
    blocker.code !== 'helixd_migration_saved_port_forwards'
  )
}
