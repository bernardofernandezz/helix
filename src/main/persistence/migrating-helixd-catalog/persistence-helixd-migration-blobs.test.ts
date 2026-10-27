import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HelixdMigrationBlobDescriptor } from '../../../shared/helixd-migration/helixd-migration-blob-transfer'
import { getHelixdMigrationReceivedBlobPath } from './helixd-migration-blob-staging'
import { manifest } from './persistence-helixd-migration-catalog-fixture'
import { createStore, testState } from '../persistence-test-harness'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))

// Use a blob kind without an installer to isolate channel behavior.
const bytes = Buffer.from('session record one\nsession record two\n')
const blob: HelixdMigrationBlobDescriptor = {
  blobKind: 'agent-session-records',
  key: 'session-kept',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  byteLength: bytes.length
}

function chunk(input: ReturnType<typeof manifest>, offset: number, end: number) {
  return {
    migrationId: input.migrationId,
    manifestSha256: input.manifestSha256,
    blob,
    offset,
    bytesBase64: bytes.subarray(offset, end).toString('base64')
  }
}

function blobRoot(): string {
  return join(testState.dir, 'helixd-migration-blobs')
}

describe('helixd migration blobs through the store', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'helix-migration-blobs-'))
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('reloads staged progress from disk and refuses commit until complete', async () => {
    const input = manifest()
    const store = createStore()
    store.stageHelixdMigrationCatalog(input)
    await store.flushPendingOrThrowAsync()
    expect(store.getHelixdMigrationCatalogState(input)).not.toHaveProperty('blobUploads')
    store.stageHelixdMigrationBlobChunk(chunk(input, 0, 8))

    const restarted = createStore()
    expect(restarted.getHelixdMigrationCatalogState(input)).toMatchObject({
      state: 'staged',
      blobUploads: [{ ...blob, receivedBytes: 8 }]
    })
    expect(() => restarted.commitStagedHelixdMigrationCatalog(input)).toThrow(
      `helixd_migration_blob_incomplete:agent-session-records:${blob.key}`
    )
    expect(restarted.getHelixdMigrationCatalogState(input).state).toBe('staged')

    restarted.stageHelixdMigrationBlobChunk(chunk(input, 8, bytes.length))
    expect(restarted.commitStagedHelixdMigrationCatalog(input).state).toBe('committed')
    expect(readFileSync(getHelixdMigrationReceivedBlobPath(blobRoot(), input, blob))).toEqual(bytes)
  })

  it('commits only the blob set the sender names, and checks nothing when it names none', () => {
    const input = manifest()
    const store = createStore()
    store.stageHelixdMigrationCatalog(input)
    store.stageHelixdMigrationBlobChunk(chunk(input, 0, bytes.length))
    const missing: HelixdMigrationBlobDescriptor = {
      blobKind: 'agent-session-records',
      key: 'session-lost',
      sha256: 'e'.repeat(64),
      byteLength: 4
    }

    expect(() =>
      store.commitStagedHelixdMigrationCatalog(input, {
        expectedBlobs: [blob, missing]
      })
    ).toThrow('helixd_migration_blob_set_mismatch:agent-session-records:session-lost')
    expect(() => store.commitStagedHelixdMigrationCatalog(input, { expectedBlobs: [] })).toThrow(
      `helixd_migration_blob_set_mismatch:agent-session-records:${blob.key}`
    )
    expect(store.getHelixdMigrationCatalogState(input).state).toBe('staged')
    expect(store.commitStagedHelixdMigrationCatalog(input, { expectedBlobs: [blob] }).state).toBe(
      'committed'
    )
  })

  it('removes staged blobs when the catalog is aborted', () => {
    const input = manifest()
    const store = createStore()
    store.stageHelixdMigrationCatalog(input)
    store.stageHelixdMigrationBlobChunk(chunk(input, 0, 8))

    expect(store.abortStagedHelixdMigrationCatalog(input)).toMatchObject({ aborted: true })
    expect(() => store.stageHelixdMigrationBlobChunk(chunk(input, 8, bytes.length))).toThrow(
      'helixd_migration_blob_catalog_not_staged'
    )
    store.stageHelixdMigrationCatalog(input)
    expect(store.getHelixdMigrationCatalogState(input)).not.toHaveProperty('blobUploads')
  })
})
