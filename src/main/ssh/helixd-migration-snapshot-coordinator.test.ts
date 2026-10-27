import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { HELIXD_MIGRATION_MANIFEST_VERSION } from '../../shared/helixd-migration/helixd-migration-manifest-validation'
import type {
  HelixdMigrationCatalogState,
  HelixdMigrationManifest
} from '../../shared/helixd-migration/helixd-migration-manifest'
import type { HelixdMigrationTerminalScrollbackSnapshot } from '../../shared/helixd-migration/helixd-migration-scrollback'
import { transferHelixdMigrationSnapshots } from './helixd-migration-snapshot-coordinator'

const BYTES = Buffer.from('resume these bytes', 'utf8')
const SNAPSHOT: HelixdMigrationTerminalScrollbackSnapshot = {
  tabId: 'tab-1',
  leafId: 'leaf-1',
  ref: `v1-${'1'.repeat(32)}`,
  sha256: createHash('sha256').update(BYTES).digest('hex'),
  byteLength: BYTES.length
}
const MANIFEST: HelixdMigrationManifest = {
  version: HELIXD_MIGRATION_MANIFEST_VERSION,
  migrationId: 'migration-1',
  createdAt: '2026-08-30T12:00:00.000Z',
  source: { sshTargetId: 'source', sshTargetGeneration: 1, targetLabel: 'Source' },
  payload: {
    repositories: [],
    projectGroups: [],
    folderWorkspaces: [],
    dormantState: {
      version: 1,
      worktreeMeta: [],
      worktreeLineage: [],
      workspaceLineage: [],
      sparsePresets: [],
      retiredWorktreeNames: [],
      retiredWorktreeNamespaces: [],
      terminalScrollbackSnapshots: [SNAPSHOT]
    }
  },
  manifestSha256: 'a'.repeat(64)
}
type ChunkReader = (
  manifest: HelixdMigrationManifest,
  ref: string,
  offset: number
) => { bytesBase64: string; totalBytes: number; eof: boolean }

function source(read: ChunkReader) {
  return {
    readHelixdMigrationSourceSnapshotChunk: read
  }
}

const unreachableRead: ChunkReader = () => {
  throw new Error('must not read')
}

describe('helixd migration snapshot coordinator', () => {
  it('resumes at the observed offset and reconciles a lost chunk response', async () => {
    const initialOffset = 4
    const sourceRead = vi.fn(() => ({
      bytesBase64: BYTES.subarray(initialOffset).toString('base64'),
      totalBytes: BYTES.length,
      eof: true
    }))
    const store = source(sourceRead)
    const snapshotRequest = vi.fn()
    const remoteReads = [staged(BYTES.length), staged(BYTES.length)]

    await transferHelixdMigrationSnapshots({
      source: store,
      manifest: MANIFEST,
      state: staged(initialOffset),
      destination: {
        stageChunk: async (request) => {
          snapshotRequest(request)
          throw new Error('response lost')
        },
        readState: async () => nextState(remoteReads)
      }
    })

    expect(sourceRead).toHaveBeenCalledWith(MANIFEST, SNAPSHOT.ref, initialOffset)
    expect(snapshotRequest).toHaveBeenCalledWith(
      expect.objectContaining({ offset: initialOffset, ref: SNAPSHOT.ref })
    )
    expect(remoteReads).toEqual([])
  })

  it('fails closed when an old host omits snapshot upload state', async () => {
    const sourceRead = vi.fn(unreachableRead)
    const store = source(sourceRead)
    await expect(
      transferHelixdMigrationSnapshots({
        source: store,
        manifest: MANIFEST,
        state: staged(),
        destination: {
          stageChunk: async () => {
            throw new Error('must not upload')
          },
          readState: async () => staged()
        }
      })
    ).rejects.toThrow('helixd_migration_snapshot_transfer_unsupported')
    expect(sourceRead).not.toHaveBeenCalled()
  })

  it('refuses a snapshot whose source length changed since export', async () => {
    await expect(
      transferHelixdMigrationSnapshots({
        source: source(() => ({
          bytesBase64: Buffer.from('changed').toString('base64'),
          totalBytes: BYTES.length + 1,
          eof: true
        })),
        manifest: MANIFEST,
        state: staged(0),
        destination: {
          stageChunk: async () => {
            throw new Error('must not upload')
          },
          readState: async () => staged(0)
        }
      })
    ).rejects.toThrow('helixd_migration_source_snapshot_changed')
  })

  it('requires complete upload evidence after the final chunk', async () => {
    const remoteReads = [staged(BYTES.length - 1)]
    await expect(
      transferHelixdMigrationSnapshots({
        source: source(unreachableRead),
        manifest: MANIFEST,
        state: staged(BYTES.length),
        destination: {
          stageChunk: async () => {
            throw new Error('must not upload')
          },
          readState: async () => nextState(remoteReads)
        }
      })
    ).rejects.toThrow('helixd_migration_snapshot_transfer_incomplete')
  })
})

function staged(receivedBytes?: number): Extract<HelixdMigrationCatalogState, { state: 'staged' }> {
  return {
    state: 'staged',
    migrationId: MANIFEST.migrationId,
    manifestSha256: MANIFEST.manifestSha256,
    stagedAt: '2026-08-30T12:01:00.000Z',
    ...(receivedBytes === undefined ? {} : { snapshotUploads: [{ ...SNAPSHOT, receivedBytes }] })
  }
}

function nextState(
  states: Extract<HelixdMigrationCatalogState, { state: 'staged' }>[]
): Extract<HelixdMigrationCatalogState, { state: 'staged' }> {
  const state = states.shift()
  if (!state) {
    throw new Error('unexpected remote read')
  }
  return state
}
