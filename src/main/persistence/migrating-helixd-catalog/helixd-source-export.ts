// Export copies of relay-hosted SSH state without mutating source rows.
import {
  HELIXD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
  type HelixdMigrationTerminalScrollbackSnapshot
} from '../../../shared/helixd-migration/helixd-migration-scrollback'
import type {
  HelixdMigrationCatalogPayload,
  HelixdMigrationDormantStatePayload,
  HelixdMigrationManifest,
  HelixdMigrationManifestSource
} from '../../../shared/helixd-migration/helixd-migration-manifest'
import { assertHelixdMigrationManifestDigest } from '../../helixd/helixd-migration-manifest-digest'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  collectHelixdMigrationUntransferredDependencyCensus,
  type HelixdMigrationSourceDependencyCensus
} from './helixd-source-dependency-census'
import { collectHelixdMigrationSourceDormantState } from './helixd-source-dormant-state'
import { readHelixdMigrationSourceScrollbackChunk } from './helixd-source-scrollback-state'
import {
  createHelixdMigrationDeltaView,
  type HelixdMigrationDeltaView
} from './helixd-source-delta-view'
import { syncHelixdMigrationScrollbackRetention } from './helixd-source-scrollback-retention'
import { createHelixdMigrationLeaveBehindView } from './helixd-source-leave-behind-view'
import {
  collectHelixdMigrationSourceDrafts,
  type HelixdMigrationSourceDrafts
} from './helixd-source-draft-rename'

type HelixdSourceExportRuntime = Pick<
  StoreRuntimeState,
  'state' | 'terminalScrollbackSnapshotStorage' | 'retainedScrollbackRefsByMigrationId'
>

const helixdSourceExportContext = Symbol('HelixdSourceExportPersistence')

export class HelixdSourceExportPersistence {
  readonly [helixdSourceExportContext]: HelixdSourceExportRuntime

  constructor(runtime: HelixdSourceExportRuntime) {
    this[helixdSourceExportContext] = runtime
  }

  collectHelixdMigrationSourceDormantState(
    source: HelixdMigrationManifestSource,
    catalog: HelixdMigrationCatalogPayload,
    destinationEnvironmentId?: string
  ): HelixdMigrationDormantStatePayload {
    const runtime = this[helixdSourceExportContext]
    return collectHelixdMigrationSourceDormantState(
      runtime.state,
      source,
      catalog,
      runtime.terminalScrollbackSnapshotStorage,
      destinationEnvironmentId
    ).payload
  }

  collectHelixdMigrationSourceDrafts(
    manifest: HelixdMigrationManifest
  ): HelixdMigrationSourceDrafts {
    return collectHelixdMigrationSourceDrafts(this[helixdSourceExportContext].state, manifest)
  }

  createHelixdMigrationDeltaView(moved: HelixdMigrationManifest): HelixdMigrationDeltaView {
    return createHelixdMigrationDeltaView(this[helixdSourceExportContext], moved)
  }

  /** Preview "Move anyway" without recording consent. */
  createHelixdMigrationLeaveBehindView(targetId: string): HelixdMigrationDeltaView {
    return createHelixdMigrationLeaveBehindView(this[helixdSourceExportContext], targetId)
  }

  inspectHelixdMigrationUntransferredDependencies(
    manifest: HelixdMigrationManifest
  ): HelixdMigrationSourceDependencyCensus {
    const runtime = this[helixdSourceExportContext]
    return collectHelixdMigrationUntransferredDependencyCensus(
      runtime.state,
      manifest,
      runtime.terminalScrollbackSnapshotStorage
    )
  }

  /** Retain unfinished migrations' snapshots even if their tabs close. */
  syncHelixdMigrationScrollbackRetention(pending: readonly HelixdMigrationManifest[]): void {
    syncHelixdMigrationScrollbackRetention(this[helixdSourceExportContext], pending)
  }

  /** Verify snapshot bytes against the signed manifest so changed buffers cannot be transferred. */
  readHelixdMigrationSourceSnapshotChunk(
    manifest: HelixdMigrationManifest,
    ref: string,
    offset: number
  ): { bytesBase64: string; totalBytes: number; eof: boolean } {
    assertHelixdMigrationManifestDigest(manifest)
    const descriptor: HelixdMigrationTerminalScrollbackSnapshot | undefined =
      manifest.payload.dormantState?.terminalScrollbackSnapshots?.find((entry) => entry.ref === ref)
    if (!descriptor) {
      throw new Error('helixd_migration_source_snapshot_unknown')
    }
    const runtime = this[helixdSourceExportContext]
    return readHelixdMigrationSourceScrollbackChunk({
      state: runtime.state,
      descriptor,
      retained: [...runtime.retainedScrollbackRefsByMigrationId.values()].some((refs) =>
        refs.has(ref)
      ),
      offset,
      length: HELIXD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
      storage: runtime.terminalScrollbackSnapshotStorage
    })
  }
}
