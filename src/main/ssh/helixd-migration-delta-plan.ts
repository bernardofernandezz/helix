/** Subtract earlier migrations' currently retained rows/state; export only additions. Never merge overlapping old source copies over server-owned state. */
import type {
  HelixdDeltaMovePreview,
  HelixdDeltaMoveRow
} from '../../shared/helixd-managed-runtime'
import type {
  HelixdMigrationCatalogPayload,
  HelixdMigrationManifest
} from '../../shared/helixd-migration/helixd-migration-manifest'
import { isRetainedHelixdMigrationSourceCutover } from '../../shared/helixd-migration/helixd-migration-source-cutover'
import type { HelixdMigrationSourceCutover } from '../../shared/helixd-migration/helixd-migration-source-cutover'
import type { SshTarget } from '../../shared/ssh-types'
import type { Store } from '../persistence'
import { collectHelixdMigrationSourceCatalog } from '../persistence/migrating-helixd-catalog/helixd-source-catalog'
import { listHelixdMigrationCutoverChainForTarget } from './helixd-migration-cutover-journal'
import {
  createHelixdMigrationManifest,
  helixdMigrationCatalogIds,
  type HelixdMigrationCatalogIds
} from './helixd-migration-manifest-export'
import type { HelixdMigrationSnapshotSource } from './helixd-migration-snapshot-coordinator'
import { collectUntransferredDependentBlockers } from './targets/ssh-target-helixd-dependents'
import type { HelixdMigrationPreflightStore } from './targets/ssh-target-helixd-preflight'

export type HelixdDeltaSourceStore = HelixdMigrationPreflightStore & HelixdMigrationSnapshotSource

export function unfinishedHelixdDelta(
  chain: readonly HelixdMigrationSourceCutover[]
): HelixdMigrationSourceCutover | null {
  const head = chain.at(-1)
  return head?.supersedesMigrationId &&
    head.phase !== 'source-retired' &&
    !isRetainedHelixdMigrationSourceCutover(head)
    ? head
    : null
}

export function committedHelixdMigrationChain(
  chain: readonly HelixdMigrationSourceCutover[]
): HelixdMigrationSourceCutover[] {
  return (unfinishedHelixdDelta(chain) ? chain.slice(0, -1) : chain).filter(
    (cutover) => cutover.phase === 'destination-committed' || cutover.phase === 'source-retired'
  )
}

export function helixdDeltaSourceStore(
  store: Store,
  target: SshTarget,
  moved: readonly HelixdMigrationSourceCutover[],
  /** Older interrupted deltas may still include server-owned groups. */
  journaled?: HelixdMigrationManifest
): HelixdDeltaSourceStore {
  const ids = helixdMigrationCatalogIds(moved.map((cutover) => cutover.manifest.payload))
  // Never move projects/groups already owned through earlier links.
  const linked = moved.flatMap((cutover) => cutover.linkedRepositoryIds ?? [])
  const linkedGroups = moved.flatMap((cutover) => cutover.linkedProjectGroupIds ?? [])
  const linkedFolders = moved.flatMap((cutover) => cutover.linkedFolderWorkspaceIds ?? [])
  // New rows reference server-owned groups; exporting retained copies could overwrite newer server edits.
  const serverGroups = new Set([...ids.projectGroupIds, ...linkedGroups])
  const exported = new Set(journaled?.payload.projectGroups.map((group) => group.id))
  return helixdSourceStoreWithout(
    store,
    target,
    {
      ...ids,
      repositoryIds: new Set([...ids.repositoryIds, ...linked]),
      folderWorkspaceIds: new Set([...ids.folderWorkspaceIds, ...linkedFolders]),
      projectGroupIds: serverGroups
    },
    moved.at(-1)?.destinationEnvironmentId,
    new Set([...serverGroups].filter((id) => !exported.has(id)))
  )
}

export function helixdSourceStoreWithout(
  store: Store,
  target: SshTarget,
  owned: HelixdMigrationCatalogIds,
  destinationEnvironmentId: string | undefined,
  /** Groups the server's record wins for: never exported, even while a moving row sits in one. */
  serverGroupIds: ReadonlySet<string> = new Set()
): HelixdDeltaSourceStore {
  const ownedNow = createHelixdMigrationManifest(store, target, {
    destinationEnvironmentId,
    onlyCatalog: owned
  })
  const view = store.createHelixdMigrationDeltaView(ownedNow)
  return {
    ...view,
    serverOwnedProjectGroupIds: serverGroupIds,
    getSshTarget: (id) => store.getSshTarget(id),
    getSshRemotePtyLeases: (id) => store.getSshRemotePtyLeases(id),
    readHelixdMigrationSourceSnapshotChunk: (...args) =>
      store.readHelixdMigrationSourceSnapshotChunk(...args)
  }
}

export type HelixdDeltaMovePlan = HelixdDeltaMovePreview & {
  manifest: HelixdMigrationManifest
  moved: HelixdMigrationSourceCutover[]
  head: HelixdMigrationSourceCutover
  resumes: HelixdMigrationSourceCutover | null
  source: HelixdDeltaSourceStore
}

export function planHelixdDeltaMove(
  userDataPath: string,
  store: Store,
  target: SshTarget,
  options: { migrationId?: string; now?: () => Date } = {}
): HelixdDeltaMovePlan {
  const environmentId = target.helixdFence?.environmentId
  if (!environmentId || !target.helixdFence?.sourceChangedAt) {
    throw new Error('helixd_delta_not_changed')
  }
  const chain = listHelixdMigrationCutoverChainForTarget(userDataPath, target.id)
  const resumes = unfinishedHelixdDelta(chain)
  const moved = committedHelixdMigrationChain(chain)
  const head = chain.at(resumes ? -2 : -1)
  if (
    !head ||
    !isRetainedHelixdMigrationSourceCutover(head) ||
    moved.at(-1)?.migrationId !== head.migrationId
  ) {
    throw new Error('helixd_delta_no_retained_migration')
  }
  const source = helixdDeltaSourceStore(store, target, moved, resumes?.manifest)
  const manifest =
    resumes?.manifest ??
    createHelixdMigrationManifest(source, target, {
      migrationId: options.migrationId,
      now: options.now,
      destinationEnvironmentId: environmentId
    })
  const current = collectHelixdMigrationSourceCatalog(store, target)
  return {
    sshTargetId: target.id,
    environmentId,
    added: catalogRows(manifest.payload),
    notReflected: notReflected(
      current,
      moved.map((cutover) => cutover.manifest.payload)
    ),
    blockers: collectUntransferredDependentBlockers(source, manifest),
    manifest,
    moved,
    head,
    resumes,
    source
  }
}

function catalogRows(catalog: HelixdMigrationCatalogPayload): HelixdDeltaMoveRow[] {
  return [
    ...catalog.repositories.map((row) => ({
      kind: 'repository' as const,
      id: row.id,
      label: row.displayName
    })),
    ...catalog.folderWorkspaces.map((row) => ({
      kind: 'folder-workspace' as const,
      id: row.id,
      label: row.name
    })),
    ...catalog.projectGroups.map((row) => ({
      kind: 'project-group' as const,
      id: row.id,
      label: row.name
    }))
  ]
}

/** Rows earlier migrations moved that an older build has since changed or removed. */
function notReflected(
  current: HelixdMigrationCatalogPayload,
  movedPayloads: readonly HelixdMigrationCatalogPayload[]
): HelixdDeltaMovePreview['notReflected'] {
  const latestMoved = new Map<string, { row: HelixdDeltaMoveRow; identity: string }>()
  for (const payload of movedPayloads) {
    for (const row of catalogRows(payload)) {
      latestMoved.set(`${row.kind}:${row.id}`, { row, identity: identityOf(payload, row) })
    }
  }
  const currentByKey = new Map(
    catalogRows(current).map((row) => [`${row.kind}:${row.id}`, identityOf(current, row)])
  )
  const edited: HelixdDeltaMoveRow[] = []
  const removed: HelixdDeltaMoveRow[] = []
  for (const [key, moved] of latestMoved) {
    const identity = currentByKey.get(key)
    if (identity === undefined) {
      removed.push(moved.row)
    } else if (identity !== moved.identity) {
      edited.push(moved.row)
    }
  }
  return { edited, removed }
}

function identityOf(catalog: HelixdMigrationCatalogPayload, row: HelixdDeltaMoveRow): string {
  switch (row.kind) {
    case 'repository': {
      const repo = catalog.repositories.find((entry) => entry.id === row.id)
      return `${repo?.path}\0${repo?.displayName}`
    }
    case 'folder-workspace': {
      const folder = catalog.folderWorkspaces.find((entry) => entry.id === row.id)
      return `${folder?.folderPath}\0${folder?.name}`
    }
    case 'project-group':
      return catalog.projectGroups.find((entry) => entry.id === row.id)?.name ?? ''
  }
}
