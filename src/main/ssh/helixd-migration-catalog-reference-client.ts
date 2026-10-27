import { parseHelixdMigrationCatalogReferenceAbortResult } from '../../shared/helixd-migration/helixd-migration-catalog-state'
import type {
  HelixdMigrationCatalogReferenceAbortResult,
  HelixdMigrationManifest
} from '../../shared/helixd-migration/helixd-migration-manifest'
import { HELIXD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY } from '../../shared/helixd-runtime-capabilities'
import { parsePairingCode } from '../../shared/pairing'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import {
  HELIXD_MIGRATION_DESTINATION_UNSUPPORTED,
  sendSupportedMigrationRequest,
  type CatalogRequestOptions
} from './helixd-migration-catalog-client'

/** Unlike migration-unsupported, this refusal cannot prove no earlier stage exists. */
export const HELIXD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED =
  'helixd_migration_destination_abort_by_reference_unsupported:Update Helix on this host to cancel this move.'

/** Abort by manifest identity when the full request cannot fit the sealed frame. */
export async function abortRemoteHelixdMigrationCatalogByReference(
  pairingCode: string,
  manifest: HelixdMigrationManifest,
  options: CatalogRequestOptions = {}
): Promise<HelixdMigrationCatalogReferenceAbortResult> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('helixd_migration_pairing_code_invalid')
  }
  let supportsReference = false
  let response: RuntimeRpcResponse<unknown>
  try {
    response = await sendSupportedMigrationRequest(
      pairing,
      'helixd.migration.abortCatalogByReference',
      { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 },
      options,
      false,
      null,
      (capabilities) => {
        supportsReference = capabilities.includes(
          HELIXD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY
        )
        if (!supportsReference) {
          throw new Error(HELIXD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED)
        }
      }
    )
  } catch (error) {
    // A missing method on a host that advertised it proves nothing about what it staged.
    if (
      supportsReference &&
      error instanceof Error &&
      error.message === HELIXD_MIGRATION_DESTINATION_UNSUPPORTED
    ) {
      throw new Error(HELIXD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED)
    }
    throw error
  }
  if (!response.ok) {
    throw new Error(`helixd_migration_abort_failed:${response.error.message}`)
  }
  return parseHelixdMigrationCatalogReferenceAbortResult(response.result, manifest)
}
