import type { PersistedState } from '../../../shared/persisted-state-types'
import type { HelixdMigrationDormantStatePayload } from '../../../shared/helixd-migration/helixd-migration-manifest'
import { serializeHelixdMigrationValue } from '../../../shared/helixd-migration/helixd-migration-manifest'
import { canonicalWorktreeIdentity } from '../../../shared/worktree/identity'
import { composeWorktreeHostIdentity } from '../../../shared/worktree/host-qualified-identity'
import { omitDefaultWorktreeMetaFields } from '../../../shared/worktree/meta-persisted-defaults'

export function assertHelixdDestinationCanonicalMetadata(
  state: PersistedState,
  entries: HelixdMigrationDormantStatePayload['worktreeMeta']
): void {
  for (const { worktreeId, meta } of entries) {
    const alias = composeWorktreeHostIdentity('local', worktreeId)
    const identities = state.worktreeIdentityAliases?.[alias] ?? []
    const expectedKey = meta.instanceId
      ? canonicalWorktreeIdentity({
          worktreeId,
          executionHostId: 'local',
          instanceId: meta.instanceId
        })
      : undefined
    const candidates = new Set([
      ...identities,
      ...(expectedKey && state.worktreeMetaByIdentity?.[expectedKey] ? [expectedKey] : [])
    ])
    if (
      candidates.size > 1 ||
      [...candidates].some((key) => {
        const current = state.worktreeMetaByIdentity?.[key]
        return (
          !current ||
          key !== expectedKey ||
          serializeHelixdMigrationValue(omitDefaultWorktreeMetaFields(current)) !==
            serializeHelixdMigrationValue(omitDefaultWorktreeMetaFields(meta))
        )
      })
    ) {
      throw new Error(`helixd_migration_dormant_id_conflict:worktree_meta:${worktreeId}`)
    }
  }
}
