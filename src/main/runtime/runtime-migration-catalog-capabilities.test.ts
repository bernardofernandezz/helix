import { describe, expect, it, vi } from 'vitest'
import { HelixRuntimeService } from './helix-runtime-test-mocks.spec'
import { store } from './helix-runtime-test-fixtures.spec'
import { HELIXD_MIGRATION_MANIFEST_VERSION } from '../../shared/helixd-migration/helixd-migration-manifest-validation'
import type {
  HelixdMigrationCatalogState,
  HelixdMigrationManifest
} from '../../shared/helixd-migration/helixd-migration-manifest'

const manifest: HelixdMigrationManifest = {
  version: HELIXD_MIGRATION_MANIFEST_VERSION,
  migrationId: 'migration-capabilities',
  createdAt: '2026-08-30T12:00:00.000Z',
  source: { sshTargetId: 'source', sshTargetGeneration: null, targetLabel: 'Source' },
  payload: { repositories: [], projectGroups: [], folderWorkspaces: [] },
  manifestSha256: '0'.repeat(64)
}

const staged: HelixdMigrationCatalogState = {
  state: 'staged',
  migrationId: manifest.migrationId,
  manifestSha256: manifest.manifestSha256,
  stagedAt: manifest.createdAt
}

describe('runtime migration catalog capabilities', () => {
  it('refuses a catalog read when the runtime has no store', () => {
    const runtime = new HelixRuntimeService(null)
    expect(() => runtime.getHelixdMigrationCatalogState(manifest)).toThrow('runtime_unavailable')
  })

  it('refuses a missing catalog reader on a partial store', () => {
    const runtime = new HelixRuntimeService(store)
    expect(() => runtime.getHelixdMigrationCatalogState(manifest)).toThrow('runtime_unavailable')
  })

  it('refuses staging before mutation when the partial store cannot flush', async () => {
    const stage = vi.fn(() => staged)
    const runtime = new HelixRuntimeService({ ...store, stageHelixdMigrationCatalog: stage })
    await expect(runtime.stageHelixdMigrationCatalog(manifest)).rejects.toThrow(
      'runtime_unavailable'
    )
    expect(stage).not.toHaveBeenCalled()
  })

  it('admits staging with only the methods that operation needs', async () => {
    const stage = vi.fn(() => staged)
    const flush = vi.fn(async () => {})
    const runtime = new HelixRuntimeService({
      ...store,
      stageHelixdMigrationCatalog: stage,
      flushPendingOrThrowAsync: flush
    })
    await expect(runtime.stageHelixdMigrationCatalog(manifest)).resolves.toBe(staged)
    expect(stage).toHaveBeenCalledWith(manifest)
    expect(flush).toHaveBeenCalledOnce()
  })
})
