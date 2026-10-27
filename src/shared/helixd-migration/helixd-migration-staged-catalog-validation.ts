import type { HelixdMigrationStagedCatalog } from './helixd-migration-manifest'
import {
  HELIXD_MIGRATION_MANIFEST_VERSION,
  parseHelixdMigrationManifest
} from './helixd-migration-manifest-validation'
import { isRecord } from './helixd-migration-manifest-fields'

export const MAX_HELIXD_MIGRATION_STAGED_CATALOGS = 4

export function normalizeHelixdMigrationStagedCatalogs(
  value: unknown
): HelixdMigrationStagedCatalog[] {
  if (!Array.isArray(value)) {
    return []
  }
  const staged: HelixdMigrationStagedCatalog[] = []
  const seen = new Set<string>()
  for (let index = value.length - 1; index >= 0; index--) {
    try {
      const entry = parseStagedCatalog(value[index])
      if (!seen.has(entry.manifest.migrationId)) {
        seen.add(entry.manifest.migrationId)
        staged.push(entry)
        if (staged.length === MAX_HELIXD_MIGRATION_STAGED_CATALOGS) {
          break
        }
      }
    } catch {
      // Invalid staging cannot prove fencing; drop it fail-closed.
    }
  }
  // Keep the migration journal runnable in the documented Node 18 rollback slot.
  return staged.reduceRight<HelixdMigrationStagedCatalog[]>((reversed, entry) => {
    reversed.push(entry)
    return reversed
  }, [])
}

function parseStagedCatalog(value: unknown): HelixdMigrationStagedCatalog {
  if (!isRecord(value) || value.version !== HELIXD_MIGRATION_MANIFEST_VERSION) {
    throw new Error('helixd_migration_staged_catalog_invalid')
  }
  const stagedAt = typeof value.stagedAt === 'string' ? value.stagedAt : ''
  if (!Number.isFinite(Date.parse(stagedAt))) {
    throw new Error('helixd_migration_staged_at_invalid')
  }
  return {
    version: HELIXD_MIGRATION_MANIFEST_VERSION,
    manifest: parseHelixdMigrationManifest(value.manifest),
    stagedAt
  }
}
