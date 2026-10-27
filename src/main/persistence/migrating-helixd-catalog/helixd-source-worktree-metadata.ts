import type { PersistedState } from '../../../shared/persisted-state-types'
import type { WorktreeMeta } from '../../../shared/worktree/meta-types'
import type { HelixdMigrationManifest } from '../../../shared/helixd-migration/helixd-migration-manifest'
import { serializeHelixdMigrationValue } from '../../../shared/helixd-migration/helixd-migration-manifest'
import { canonicalWorktreeIdentity } from '../../../shared/worktree/identity'
import {
  getExecutionHostIdFromWorktreeHostIdentity,
  isWorktreeHostIdentity
} from '../../../shared/worktree/host-qualified-identity'
import { pruneUnreferencedWorktreeIdentityMeta } from '../loading-store/worktree-identity-metadata'
import {
  createHelixdMigrationSourceScope,
  helixdMigrationOwnerMatchesScope,
  unqualifyHelixdMigrationOwnerKey,
  type HelixdMigrationSourceScope
} from './helixd-source-scope'

export function inspectHelixdSourceWorktreeMetadata(
  state: PersistedState,
  scope: HelixdMigrationSourceScope
) {
  const rows: { sourceKey: string; meta: WorktreeMeta }[] = []
  let blockedCount = 0
  for (const [sourceKey, meta] of Object.entries(state.worktreeMeta)) {
    const host = getExecutionHostIdFromWorktreeHostIdentity(sourceKey)
    if ((host && host !== scope.hostId) || (meta.hostId && meta.hostId !== scope.hostId)) {
      if (host === scope.hostId || meta.hostId === scope.hostId) {
        blockedCount++
      }
      continue
    }
    if (helixdMigrationOwnerMatchesScope(sourceKey, scope, meta.hostId)) {
      rows.push({ sourceKey, meta })
    } else if (meta.hostId === scope.hostId || host === scope.hostId) {
      blockedCount++
    }
  }
  const referenced = new Set(Object.values(state.worktreeIdentityAliases ?? {}).flat())
  for (const [identity, meta] of Object.entries(state.worktreeMetaByIdentity ?? {})) {
    if (meta.hostId === scope.hostId && !referenced.has(identity)) {
      blockedCount++
    }
  }
  for (const [alias, identities] of Object.entries(state.worktreeIdentityAliases ?? {})) {
    if (getExecutionHostIdFromWorktreeHostIdentity(alias) !== scope.hostId) {
      continue
    }
    if (isDanglingAlias(state, identities) && helixdMigrationOwnerMatchesScope(alias, scope)) {
      continue // Dangling aliases carry no metadata; any legacy row migrates separately.
    }
    const meta = identities.length === 1 ? state.worktreeMetaByIdentity?.[identities[0]] : undefined
    const worktreeId = unqualifyHelixdMigrationOwnerKey(alias)
    if (
      isWorktreeHostIdentity(worktreeId) ||
      !helixdMigrationOwnerMatchesScope(alias, scope) ||
      !meta ||
      !meta.instanceId ||
      (meta.hostId !== undefined && meta.hostId !== scope.hostId) ||
      identities[0] !==
        canonicalWorktreeIdentity({
          worktreeId,
          executionHostId: scope.hostId,
          instanceId: meta.instanceId
        })
    ) {
      blockedCount++
      continue
    }
    const legacy = rows.filter(
      (row) => unqualifyHelixdMigrationOwnerKey(row.sourceKey) === worktreeId
    )
    if (
      legacy.length > 1 ||
      (legacy.length === 1 &&
        serializeHelixdMigrationValue({ ...legacy[0].meta, hostId: scope.hostId }) !==
          serializeHelixdMigrationValue({ ...meta, hostId: scope.hostId }))
    ) {
      // Neither representation may silently discard data held only by its competing row.
      blockedCount++
      continue
    }
    if (legacy.length === 0) {
      rows.push({ sourceKey: alias, meta: { ...meta, hostId: scope.hostId } })
    }
  }
  return { rows, blockedCount }
}

export function subtractHelixdSourceWorktreeMetadata(
  state: PersistedState,
  manifest: HelixdMigrationManifest
) {
  const scope = createHelixdMigrationSourceScope({
    source: manifest.source,
    catalog: manifest.payload,
    repos: state.repos
  })
  const entries = manifest.payload.dormantState?.worktreeMeta ?? []
  // The server owns moved projects, including rows added later by downgraded builds.
  const added = inspectHelixdSourceWorktreeMetadata(state, scope).rows.map((row) => row.sourceKey)
  const sourceKeys = new Set([...entries.map((entry) => entry.sourceKey), ...added])
  const worktreeIds = new Set([
    ...entries.map((entry) => entry.worktreeId),
    ...added.map(unqualifyHelixdMigrationOwnerKey)
  ])
  const removedIdentities = new Set<string>()
  for (const [alias, identities] of Object.entries(state.worktreeIdentityAliases ?? {})) {
    if (
      getExecutionHostIdFromWorktreeHostIdentity(alias) === scope.hostId &&
      (worktreeIds.has(unqualifyHelixdMigrationOwnerKey(alias)) ||
        (isDanglingAlias(state, identities) && helixdMigrationOwnerMatchesScope(alias, scope)))
    ) {
      identities.forEach((identity) => removedIdentities.add(identity))
      delete state.worktreeIdentityAliases?.[alias]
    }
  }
  sourceKeys.forEach((sourceKey) => delete state.worktreeMeta[sourceKey])
  pruneUnreferencedWorktreeIdentityMeta(state, removedIdentities)
}

function isDanglingAlias(state: PersistedState, identities: readonly string[]): boolean {
  return identities.every((identity) => {
    const meta = state.worktreeMetaByIdentity?.[identity]
    return !meta || Object.keys(meta).length === 0
  })
}
