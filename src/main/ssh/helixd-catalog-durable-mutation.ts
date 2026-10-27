import type { HelixdMigrationCatalogState } from '../../shared/helixd-migration/helixd-migration-manifest'

export async function resolveDurableHelixdCatalogMutation(
  mutate: () => Promise<HelixdMigrationCatalogState>,
  read: () => Promise<HelixdMigrationCatalogState>,
  accepted: (state: HelixdMigrationCatalogState) => boolean
) {
  try {
    return await mutate()
  } catch (mutationError) {
    let observed: HelixdMigrationCatalogState
    try {
      observed = await read()
    } catch {
      throw mutationError
    }
    if (!accepted(observed)) {
      throw mutationError
    }
  }
  // State reads may reflect unflushed mutations; an idempotent acknowledgment proves durability.
  return mutate()
}
