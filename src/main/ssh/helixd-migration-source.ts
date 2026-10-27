/** Expose fenced-source checks/release through the cutover port; conversion owns terminal assessment, export and fence acquisition. */
import type { HelixdMigrationSourceKind } from '../../shared/helixd-migration/helixd-migration-source-kind'
import type {
  HelixdMigrationCatalogPayload,
  HelixdMigrationManifest
} from '../../shared/helixd-migration/helixd-migration-manifest'
import type { HelixdMigrationSourceCutover } from '../../shared/helixd-migration/helixd-migration-source-cutover'
import type { HelixdMigrationManifestExportOptions } from './helixd-migration-manifest-export'
import type {
  HelixdMigrationFenceResult,
  HelixdMigrationFenceState
} from './helixd-migration-source-fence'
import type { HelixdMigrationTerminalVerdict } from './helixd-migration-terminal-gate'

export type HelixdMigrationSourceCutoverPort = {
  /** Before every stage and commit; throws unless the fenced source still matches the journal. */
  verifyFence: (cutover: HelixdMigrationSourceCutover) => void
  /** Drops the fence, then the journal; only on proof the destination holds nothing. */
  releaseFence: (cutover: HelixdMigrationSourceCutover) => Promise<void>
}

type HelixdMigrationFenceAcquireArgs = {
  destinationEnvironmentId: string
  destinationName: string
  terminalProof: HelixdMigrationTerminalVerdict
  now?: () => Date
  signal?: AbortSignal
}

export type HelixdMigrationSource = HelixdMigrationSourceCutoverPort & {
  readonly kind: HelixdMigrationSourceKind
  readonly journalKey: string
  collectCatalog: () => HelixdMigrationCatalogPayload
  /** Rewrite paths before signing; export must not mutate source. */
  exportManifest: (options?: HelixdMigrationManifestExportOptions) => HelixdMigrationManifest
  /** Before the fence. Loss of contact is `unverifiable`, never `exited`. */
  assessTerminals: () => Promise<HelixdMigrationTerminalVerdict>
  retireProvenExitedTerminals: (proof: HelixdMigrationTerminalVerdict) => void
  /** Throws when the journal cannot be read: an unreadable record keeps the source fenced. */
  resolveFence: () => HelixdMigrationFenceState
  /** Journal, then fence, then flush, then the terminal re-check under the fence. */
  acquireFence: (args: HelixdMigrationFenceAcquireArgs) => Promise<HelixdMigrationFenceResult>
}
