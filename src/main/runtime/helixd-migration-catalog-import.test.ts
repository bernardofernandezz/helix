import { describe, expect, it, vi } from 'vitest'
import type {
  HelixdMigrationCatalogAbortResult,
  HelixdMigrationCatalogReferenceAbortResult,
  HelixdMigrationCatalogState
} from '../../shared/helixd-migration/helixd-migration-manifest'
import { helixdMigrationCutoverFixture } from '../ssh/helixd-migration-cutover-fixture'
import {
  abortStagedHelixdMigrationCatalogByReferenceDurably,
  abortStagedHelixdMigrationCatalogDurably,
  commitStagedHelixdMigrationCatalogDurably,
  stageHelixdMigrationCatalogDurably
} from './helixd-migration-catalog-import'

const { manifest } = helixdMigrationCutoverFixture()
const reference = { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 }

describe('durable helixd migration catalog import', () => {
  it('does not acknowledge staging until its dormant manifest is durable', async () => {
    const diskError = new Error('disk full')
    const staged: HelixdMigrationCatalogState = {
      state: 'staged',
      ...reference,
      stagedAt: '2026-10-01T00:00:01.000Z'
    }
    const stage = vi.fn().mockReturnValue(staged)
    const flush = vi.fn().mockRejectedValueOnce(diskError).mockResolvedValueOnce(undefined)
    const args = {
      store: {
        stageHelixdMigrationCatalog: stage,
        flushPendingOrThrowAsync: flush
      },
      manifest
    }

    await expect(stageHelixdMigrationCatalogDurably(args)).rejects.toBe(diskError)
    await expect(stageHelixdMigrationCatalogDurably(args)).resolves.toBe(staged)
    expect(stage).toHaveBeenCalledTimes(2)
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('publishes a committed catalog only after its receipt is durable', async () => {
    const diskError = new Error('disk full')
    const committed: HelixdMigrationCatalogState = {
      state: 'committed',
      ...reference,
      receipt: {
        version: manifest.version,
        ...reference,
        source: manifest.source,
        importedAt: '2026-10-01T00:00:02.000Z',
        repositoryIds: [],
        projectGroupIds: [],
        folderWorkspaceIds: []
      }
    }
    const commit = vi.fn().mockReturnValue(committed)
    const flush = vi.fn().mockRejectedValueOnce(diskError).mockResolvedValueOnce(undefined)
    const onDurableCommit = vi.fn()
    const args = {
      store: {
        commitStagedHelixdMigrationCatalog: commit,
        flushPendingOrThrowAsync: flush
      },
      manifest,
      onDurableCommit
    }

    await expect(commitStagedHelixdMigrationCatalogDurably(args)).rejects.toBe(diskError)
    expect(onDurableCommit).not.toHaveBeenCalled()
    await expect(commitStagedHelixdMigrationCatalogDurably(args)).resolves.toBe(committed)
    expect(onDurableCommit).toHaveBeenCalledOnce()
  })

  it('reflushes an already-absent abort after the first flush failed', async () => {
    const aborted: HelixdMigrationCatalogAbortResult = {
      state: 'absent',
      ...reference,
      aborted: true
    }
    const unchanged: HelixdMigrationCatalogAbortResult = { ...aborted, aborted: false }
    const abort = vi.fn().mockReturnValueOnce(aborted).mockReturnValueOnce(unchanged)
    const flush = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const args = {
      store: {
        abortStagedHelixdMigrationCatalog: abort,
        flushPendingOrThrowAsync: flush
      },
      manifest
    }

    await expect(abortStagedHelixdMigrationCatalogDurably(args)).rejects.toThrow('disk full')
    await expect(abortStagedHelixdMigrationCatalogDurably(args)).resolves.toEqual({
      ...unchanged,
      durableAbsent: true
    })
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('answers an abort by reference absent only once its flush succeeds', async () => {
    const aborted: HelixdMigrationCatalogReferenceAbortResult = {
      ...reference,
      state: 'absent',
      aborted: true
    }
    const unchanged: HelixdMigrationCatalogReferenceAbortResult = { ...aborted, aborted: false }
    const abort = vi.fn().mockReturnValueOnce(aborted).mockReturnValueOnce(unchanged)
    const flush = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const args = {
      store: {
        abortStagedHelixdMigrationCatalogByReference: abort,
        flushPendingOrThrowAsync: flush
      },
      reference
    }

    await expect(abortStagedHelixdMigrationCatalogByReferenceDurably(args)).rejects.toThrow(
      'disk full'
    )
    await expect(abortStagedHelixdMigrationCatalogByReferenceDurably(args)).resolves.toEqual({
      ...unchanged,
      durableAbsent: true
    })
    expect(flush).toHaveBeenCalledTimes(2)
  })
})
