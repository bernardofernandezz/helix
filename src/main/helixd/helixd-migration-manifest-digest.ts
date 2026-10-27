import { createHash } from 'node:crypto'
import {
  helixdMigrationManifestHashInput,
  serializeHelixdMigrationValue,
  type HelixdMigrationManifest
} from '../../shared/helixd-migration/helixd-migration-manifest'

export function computeHelixdMigrationManifestSha256(
  manifest: Omit<HelixdMigrationManifest, 'manifestSha256'>
): string {
  return createHash('sha256').update(helixdMigrationManifestHashInput(manifest)).digest('hex')
}

/** Hash the received manifest: unknown fields from newer peers are part of its signature. */
export function assertHelixdMigrationManifestDigest(manifest: unknown): void {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error('helixd_migration_manifest_invalid')
  }
  const unsigned = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== 'manifestSha256')
  )
  const digest = createHash('sha256').update(serializeHelixdMigrationValue(unsigned)).digest('hex')
  if (!('manifestSha256' in manifest) || digest !== manifest.manifestSha256) {
    throw new Error('helixd_migration_manifest_digest_mismatch')
  }
}
