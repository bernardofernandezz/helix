import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HELIXD_MIGRATION_MANIFEST_VERSION } from '../../shared/helixd-migration/helixd-migration-manifest-validation'
import type { HelixdMigrationManifest } from '../../shared/helixd-migration/helixd-migration-manifest'
import { computeHelixdMigrationManifestSha256 } from '../helixd/helixd-migration-manifest-digest'
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../shared/pairing'

const sendRequest = vi.hoisted(() => vi.fn())
const status = vi.hoisted(() => ({ capabilities: ['helixd.migration-catalog.v1'] }))
// Run status preflight, then adapt to the existing single-call assertions.
vi.mock('../../shared/remote-runtime-client', () => ({
  sendRemoteRuntimeRequestWithStatusPreflight: async (
    pairing: unknown,
    method: string,
    params: unknown,
    timeoutMs: number,
    validate: (response: unknown) => void,
    envelope: unknown,
    capabilities: unknown,
    signal: unknown
  ) => {
    validate({
      ok: true,
      _meta: { runtimeId: 'runtime' },
      result: { capabilities: status.capabilities }
    })
    return sendRequest(pairing, method, params, timeoutMs, envelope, signal, capabilities)
  }
}))

const {
  abortRemoteHelixdMigrationCatalog,
  commitRemoteHelixdMigrationCatalog,
  listRemoteHelixdRepositories,
  readRemoteHelixdMigrationCatalogState,
  stageRemoteHelixdMigrationCatalog,
  stageRemoteHelixdMigrationSnapshotChunk
} = await import('./helixd-migration-catalog-client')
const { listRemoteHelixdFolderCatalog } = await import('./helixd-server-folder-workspaces')

function manifest(): HelixdMigrationManifest {
  const unsigned = {
    version: HELIXD_MIGRATION_MANIFEST_VERSION,
    migrationId: 'migration-1',
    createdAt: '2026-08-30T12:00:00.000Z',
    source: {
      sshTargetId: 'ssh-prod',
      sshTargetGeneration: 7,
      targetLabel: 'Production'
    },
    payload: { repositories: [], projectGroups: [], folderWorkspaces: [] }
  }
  return { ...unsigned, manifestSha256: computeHelixdMigrationManifestSha256(unsigned) }
}

const pairingCode = encodePairingOffer({
  v: PAIRING_OFFER_VERSION,
  endpoint: 'ws://127.0.0.1:46768/runtime',
  deviceToken: 'device-token',
  publicKeyB64: 'public-key',
  pairedDeviceId: 'paired-desktop'
})

beforeEach(() => {
  vi.clearAllMocks()
  status.capabilities = ['helixd.migration-catalog.v1']
})

describe('remote helixd migration catalog client', () => {
  it.each([
    stageRemoteHelixdMigrationCatalog,
    commitRemoteHelixdMigrationCatalog,
    readRemoteHelixdMigrationCatalogState,
    abortRemoteHelixdMigrationCatalog
  ])(
    'refuses another runtime or missing authenticated runtime metadata when pinned',
    async (request) => {
      for (const runtimeId of ['other-runtime', undefined]) {
        sendRequest.mockResolvedValue({ ok: true, _meta: { runtimeId }, result: {} })
        await expect(
          request(pairingCode, manifest(), { expectedRuntimeId: 'runtime' })
        ).rejects.toThrow('destination_runtime_mismatch')
      }
    }
  )

  it('keeps each server project’s execution host, so a nested SSH row is never read as local', async () => {
    sendRequest.mockResolvedValue({
      ok: true,
      result: {
        repos: [
          { id: 'own', path: '/root/a', connectionId: null, displayName: 'own' },
          { id: 'nested', path: '/root/b', connectionId: 'ssh-nested' },
          { id: 'runtime', path: '/root/c', executionHostId: 'runtime:env' },
          // An older helixd row: no host fields at all.
          { id: 'legacy', path: '/root/d' }
        ]
      }
    })
    await expect(listRemoteHelixdRepositories(pairingCode)).resolves.toEqual([
      { id: 'own', path: '/root/a' },
      { id: 'nested', path: '/root/b', connectionId: 'ssh-nested' },
      { id: 'runtime', path: '/root/c', executionHostId: 'runtime:env' },
      { id: 'legacy', path: '/root/d' }
    ])
  })

  it('reads the server’s folder workspaces and the groups that place them on a host', async () => {
    sendRequest.mockImplementation(async (_pairing, method: string) => ({
      ok: true,
      result:
        method === 'folderWorkspace.list'
          ? {
              folderWorkspaces: [
                { id: 'own', folderPath: '/root/a', projectGroupId: 'g', connectionId: null },
                { id: 'nested', folderPath: '/root/b', projectGroupId: 'g', connectionId: 'ssh-x' }
              ]
            }
          : {
              groups: [
                { id: 'g', name: 'G', parentGroupId: null },
                { id: 'h', executionHostId: 'ssh:other' }
              ]
            }
    }))
    await expect(listRemoteHelixdFolderCatalog(pairingCode)).resolves.toEqual({
      folderWorkspaces: [
        { id: 'own', folderPath: '/root/a', projectGroupId: 'g', connectionId: null },
        { id: 'nested', folderPath: '/root/b', projectGroupId: 'g', connectionId: 'ssh-x' }
      ],
      projectGroups: [
        { id: 'g', parentGroupId: null },
        { id: 'h', parentGroupId: null, executionHostId: 'ssh:other' }
      ]
    })
    expect(sendRequest.mock.calls.map((call) => call[1]).sort()).toEqual([
      'folderWorkspace.list',
      'projectGroup.list'
    ])
  })

  it('pins snapshot acknowledgments to the admitted destination runtime', async () => {
    const request = {
      migrationId: 'migration-1',
      manifestSha256: manifest().manifestSha256,
      ref: `v1-${'1'.repeat(32)}`,
      offset: 0,
      bytesBase64: 'YQ=='
    }
    sendRequest.mockResolvedValue({
      ok: true,
      _meta: { runtimeId: 'other' },
      result: { ...request, acknowledgedOffset: 1 }
    })
    await expect(
      stageRemoteHelixdMigrationSnapshotChunk(pairingCode, request, {
        expectedRuntimeId: 'runtime'
      })
    ).rejects.toThrow('destination_runtime_mismatch')
    sendRequest.mockResolvedValue({
      ok: true,
      _meta: { runtimeId: 'runtime' },
      result: { ...request, acknowledgedOffset: 1 }
    })
    await expect(
      stageRemoteHelixdMigrationSnapshotChunk(pairingCode, request, {
        expectedRuntimeId: 'runtime'
      })
    ).resolves.toMatchObject({ acknowledgedOffset: 1 })
  })

  it.each([
    ['stage', 'helixd.migration.stageCatalog', stageRemoteHelixdMigrationCatalog],
    ['commit', 'helixd.migration.commitCatalog', commitRemoteHelixdMigrationCatalog],
    ['state', 'helixd.migration.catalogState', readRemoteHelixdMigrationCatalogState]
  ] as const)('sends and validates the %s operation', async (_label, method, request) => {
    const input = manifest()
    const result = {
      state: 'staged',
      migrationId: input.migrationId,
      manifestSha256: input.manifestSha256,
      stagedAt: '2026-08-30T12:01:00.000Z'
    }
    sendRequest.mockResolvedValue({ ok: true, result })
    const signal = new AbortController().signal

    await expect(request(pairingCode, input, { signal, timeoutMs: 1234 })).resolves.toEqual(result)
    expect(sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'ws://127.0.0.1:46768/runtime' }),
      method,
      { manifest: input },
      1234,
      undefined,
      signal,
      expect.any(Object)
    )
  })

  it('validates an abort result without letting it erase committed state', async () => {
    const input = manifest()
    sendRequest.mockResolvedValue({
      ok: true,
      result: {
        state: 'absent',
        migrationId: input.migrationId,
        manifestSha256: input.manifestSha256,
        aborted: true
      }
    })

    await expect(abortRemoteHelixdMigrationCatalog(pairingCode, input)).resolves.toMatchObject({
      state: 'absent',
      aborted: true
    })
  })

  it.each([undefined, true, false, 'true'])(
    'requires explicit persistence evidence for an already-absent abort (%s)',
    async (durableAbsent) => {
      const input = manifest()
      sendRequest.mockResolvedValue({
        ok: true,
        result: {
          state: 'absent',
          migrationId: input.migrationId,
          manifestSha256: input.manifestSha256,
          aborted: false,
          ...(durableAbsent === undefined ? {} : { durableAbsent })
        }
      })
      const result = abortRemoteHelixdMigrationCatalog(pairingCode, input)
      if (durableAbsent === true) {
        await expect(result).resolves.toMatchObject({ durableAbsent: true, aborted: false })
        return
      }
      await expect(result).rejects.toThrow(/durability/)
    }
  )

  it('validates a committed receipt against the requested manifest', async () => {
    const input = manifest()
    const receipt = {
      version: HELIXD_MIGRATION_MANIFEST_VERSION,
      migrationId: input.migrationId,
      manifestSha256: input.manifestSha256,
      source: input.source,
      importedAt: '2026-08-30T12:02:00.000Z',
      repositoryIds: [],
      projectGroupIds: [],
      folderWorkspaceIds: []
    }
    sendRequest.mockResolvedValue({
      ok: true,
      result: {
        state: 'committed',
        migrationId: input.migrationId,
        manifestSha256: input.manifestSha256,
        receipt
      }
    })

    await expect(commitRemoteHelixdMigrationCatalog(pairingCode, input)).resolves.toMatchObject({
      state: 'committed',
      receipt
    })
  })

  it('uploads a snapshot chunk and requires the exact acknowledgment', async () => {
    const input = manifest()
    const request = {
      migrationId: input.migrationId,
      manifestSha256: input.manifestSha256,
      ref: `v1-${'1'.repeat(32)}`,
      offset: 4,
      bytesBase64: 'YQ=='
    }
    sendRequest.mockResolvedValueOnce({
      ok: true,
      result: { ...request, acknowledgedOffset: 5 }
    })
    await expect(
      stageRemoteHelixdMigrationSnapshotChunk(pairingCode, request)
    ).resolves.toMatchObject({ acknowledgedOffset: 5 })
    expect(sendRequest).toHaveBeenLastCalledWith(
      expect.any(Object),
      'helixd.migration.stageSnapshotChunk',
      request,
      15_000,
      undefined,
      undefined,
      expect.any(Object)
    )

    sendRequest.mockResolvedValueOnce({
      ok: true,
      result: { ...request, acknowledgedOffset: 4 }
    })
    await expect(stageRemoteHelixdMigrationSnapshotChunk(pairingCode, request)).rejects.toThrow(
      'helixd_migration_snapshot_chunk_result_invalid'
    )
  })

  it('fails closed when a staged old host omits required snapshot upload state', async () => {
    const input = manifest()
    input.payload.dormantState = {
      version: 1,
      worktreeMeta: [],
      worktreeLineage: [],
      workspaceLineage: [],
      sparsePresets: [],
      retiredWorktreeNames: [],
      retiredWorktreeNamespaces: [],
      terminalScrollbackSnapshots: [
        {
          tabId: 'tab-1',
          leafId: 'leaf-1',
          ref: `v1-${'1'.repeat(32)}`,
          sha256: 'b'.repeat(64),
          byteLength: 1
        }
      ]
    }
    sendRequest.mockResolvedValue({
      ok: true,
      result: {
        state: 'staged',
        migrationId: input.migrationId,
        manifestSha256: input.manifestSha256,
        stagedAt: '2026-08-30T12:01:00.000Z'
      }
    })

    await expect(readRemoteHelixdMigrationCatalogState(pairingCode, input)).rejects.toThrow(
      'helixd_migration_snapshot_transfer_unsupported'
    )
  })

  it('rejects malformed stage timestamps and abort envelopes', async () => {
    const input = manifest()
    sendRequest.mockResolvedValueOnce({
      ok: true,
      result: {
        state: 'staged',
        migrationId: input.migrationId,
        manifestSha256: input.manifestSha256,
        stagedAt: 'not-a-date'
      }
    })
    await expect(stageRemoteHelixdMigrationCatalog(pairingCode, input)).rejects.toThrow(
      'helixd_migration_catalog_state_staged_at_invalid'
    )

    sendRequest.mockResolvedValueOnce({
      ok: true,
      result: {
        state: 'absent',
        migrationId: input.migrationId,
        manifestSha256: input.manifestSha256
      }
    })
    await expect(abortRemoteHelixdMigrationCatalog(pairingCode, input)).rejects.toThrow(
      'helixd_migration_catalog_abort_result_invalid'
    )
  })

  it('fails closed for method absence, malformed identity, and invalid pairing', async () => {
    const input = manifest()
    sendRequest.mockResolvedValueOnce({ ok: false, error: { message: 'method not found' } })
    await expect(stageRemoteHelixdMigrationCatalog(pairingCode, input)).rejects.toThrow(
      'helixd_migration_stage_failed:method not found'
    )

    sendRequest.mockResolvedValueOnce({
      ok: true,
      result: { state: 'absent', migrationId: 'other', manifestSha256: input.manifestSha256 }
    })
    await expect(readRemoteHelixdMigrationCatalogState(pairingCode, input)).rejects.toThrow(
      'helixd_migration_catalog_state_identity_mismatch'
    )

    await expect(stageRemoteHelixdMigrationCatalog('invalid', input)).rejects.toThrow(
      'helixd_migration_pairing_code_invalid'
    )
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('refuses a destination without the capability before sending any migration request', async () => {
    status.capabilities = []
    await expect(stageRemoteHelixdMigrationCatalog(pairingCode, manifest())).rejects.toThrow(
      'helixd_migration_destination_unsupported'
    )
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('reads method-not-found as the same refusal, not as a lost answer', async () => {
    sendRequest.mockResolvedValue({
      ok: false,
      _meta: { runtimeId: 'runtime' },
      error: { code: 'method_not_found', message: 'Unknown method' }
    })
    await expect(commitRemoteHelixdMigrationCatalog(pairingCode, manifest())).rejects.toThrow(
      'helixd_migration_destination_unsupported'
    )
  })
})
