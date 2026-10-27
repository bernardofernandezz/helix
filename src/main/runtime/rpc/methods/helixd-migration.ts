import type { z } from 'zod'
import {
  HelixdMigrationCatalogParams,
  HelixdMigrationCatalogReferenceParams,
  HelixdMigrationCommitCatalogParams
} from '../../../../shared/rpc-contract/helixd-migration-params'
import { parseHelixdMigrationManifest } from '../../../../shared/helixd-migration/helixd-migration-manifest-validation'
import { HelixdMigrationSnapshotChunkRequestSchema } from '../../../../shared/helixd-migration/helixd-migration-scrollback'
import { HelixdMigrationBlobChunkRequestSchema } from '../../../../shared/helixd-migration/helixd-migration-blob-transfer'
import { assertHelixdMigrationManifestDigest } from '../../../helixd/helixd-migration-manifest-digest'
import { assertHelixdMigrationSourceServedHere } from '../../../helixd/helixd-migration-wsl-destination'
import { defineMethod, type RpcContext } from '../core'

export const HELIXD_MIGRATION_METHODS = [
  defineMethod({
    name: 'helixd.migration.stageCatalog',
    permission: 'host-admin',
    params: HelixdMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageHelixdMigrationCatalog(migrationManifest(params), {
        signal: context.signal
      })
    }
  }),
  defineMethod({
    name: 'helixd.migration.commitCatalog',
    permission: 'host-admin',
    params: HelixdMigrationCommitCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.commitStagedHelixdMigrationCatalog(migrationManifest(params), {
        signal: context.signal,
        ...(params.expectedBlobs ? { expectedBlobs: params.expectedBlobs } : {})
      })
    }
  }),
  defineMethod({
    name: 'helixd.migration.stageSnapshotChunk',
    permission: 'host-admin',
    params: HelixdMigrationSnapshotChunkRequestSchema,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageHelixdMigrationSnapshotChunk(params)
    }
  }),
  // A separate method, not a field on stageSnapshotChunk: an older host would strip the field and
  // stage the bytes as a snapshot.
  defineMethod({
    name: 'helixd.migration.stageBlobChunk',
    permission: 'host-admin',
    params: HelixdMigrationBlobChunkRequestSchema,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.stageHelixdMigrationBlobChunk(params)
    }
  }),
  defineMethod({
    name: 'helixd.migration.abortCatalog',
    permission: 'host-admin',
    params: HelixdMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.abortStagedHelixdMigrationCatalog(migrationManifest(params), {
        signal: context.signal
      })
    }
  }),
  // Why a reference: a source fenced on a manifest no request can carry must still be releasable.
  defineMethod({
    name: 'helixd.migration.abortCatalogByReference',
    permission: 'host-admin',
    params: HelixdMigrationCatalogReferenceParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.abortStagedHelixdMigrationCatalogByReference(params, {
        signal: context.signal
      })
    }
  }),
  defineMethod({
    name: 'helixd.migration.catalogState',
    permission: 'host-admin',
    params: HelixdMigrationCatalogParams,
    handler: async (params, context) => {
      requireMigrationRuntimeClient(context)
      return context.runtime.getHelixdMigrationCatalogState(migrationManifest(params))
    }
  })
]

function migrationManifest(params: z.infer<typeof HelixdMigrationCatalogParams>) {
  const manifest = parseHelixdMigrationManifest(params.manifest)
  // Raw, not parsed: parsing drops fields this host predates, which a newer client signed.
  assertHelixdMigrationManifestDigest(params.manifest)
  assertHelixdMigrationSourceServedHere(manifest.source)
  return manifest
}

function requireMigrationRuntimeClient(context: RpcContext): void {
  if (context.clientKind !== 'runtime' || !context.pairedDeviceId) {
    throw new Error('helixd_migration_runtime_client_required')
  }
}
