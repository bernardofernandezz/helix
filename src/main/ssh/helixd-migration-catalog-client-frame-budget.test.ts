import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HelixdMigrationBlobDescriptor } from '../../shared/helixd-migration/helixd-migration-blob-transfer'
import type { HelixdMigrationManifest } from '../../shared/helixd-migration/helixd-migration-manifest'
import {
  MAX_HELIXD_MIGRATION_MANIFEST_BYTES,
  HELIXD_MIGRATION_MANIFEST_VERSION
} from '../../shared/helixd-migration/helixd-migration-manifest-validation'
import {
  HELIXD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
  HELIXD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY,
  HELIXD_MIGRATION_CATALOG_RUNTIME_CAPABILITY
} from '../../shared/helixd-runtime-capabilities'
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../shared/pairing'

const sendRequest = vi.hoisted(() => vi.fn())
const extraCapabilities = vi.hoisted((): string[] => [])
vi.mock('../../shared/remote-runtime-client', () => ({
  sendRemoteRuntimeRequestWithStatusPreflight: async (
    pairing: unknown,
    method: string,
    params: unknown,
    _timeoutMs: number,
    validate: (response: unknown) => void
  ) => {
    validate({
      ok: true,
      _meta: { runtimeId: 'runtime' },
      result: {
        capabilities: [
          HELIXD_MIGRATION_CATALOG_RUNTIME_CAPABILITY,
          HELIXD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY,
          'helixd.migration-blob.agent-session-records.v1',
          ...extraCapabilities
        ]
      }
    })
    return sendRequest(pairing, method, params)
  }
}))

const { commitRemoteHelixdMigrationCatalog, stageRemoteHelixdMigrationCatalog } =
  await import('./helixd-migration-catalog-client')
const {
  abortRemoteHelixdMigrationCatalogByReference,
  HELIXD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED
} = await import('./helixd-migration-catalog-reference-client')

const pairingCode = encodePairingOffer({
  v: PAIRING_OFFER_VERSION,
  endpoint: 'ws://127.0.0.1:46768/runtime',
  deviceToken: 'device-token',
  publicKeyB64: 'public-key',
  pairedDeviceId: 'paired-desktop'
})

function manifestOfBytes(bytes: number): HelixdMigrationManifest {
  const withLabel = (targetLabel: string): HelixdMigrationManifest => ({
    version: HELIXD_MIGRATION_MANIFEST_VERSION,
    migrationId: 'migration-frame',
    createdAt: '2026-10-18T12:00:00.000Z',
    source: { sshTargetId: 'source', sshTargetGeneration: 1, targetLabel },
    payload: { repositories: [], projectGroups: [], folderWorkspaces: [] },
    manifestSha256: 'a'.repeat(64)
  })
  return withLabel('x'.repeat(bytes - JSON.stringify(withLabel('')).length))
}

const manyBlobs: HelixdMigrationBlobDescriptor[] = Array.from({ length: 200 }, (_, index) => ({
  blobKind: 'agent-session-records',
  key: `session-${index}-${'s'.repeat(64)}`,
  sha256: 'c'.repeat(64),
  byteLength: 1024
}))

beforeEach(() => {
  vi.clearAllMocks()
  extraCapabilities.length = 0
  sendRequest.mockResolvedValue({
    ok: true,
    _meta: { runtimeId: 'runtime' },
    result: {
      state: 'staged',
      migrationId: 'migration-frame',
      manifestSha256: 'a'.repeat(64),
      stagedAt: '2026-10-18T12:00:00.000Z'
    }
  })
})

describe("helixd migration requests fit the host's sealed inbound frame", () => {
  it('stages a large manifest that still fits', async () => {
    await stageRemoteHelixdMigrationCatalog(pairingCode, manifestOfBytes(760 * 1024))
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('refuses, unsent, a manifest at the validation cap: sealed, it overflows the 1 MiB frame', async () => {
    await expect(
      stageRemoteHelixdMigrationCatalog(
        pairingCode,
        manifestOfBytes(MAX_HELIXD_MIGRATION_MANIFEST_BYTES)
      )
    ).rejects.toThrow(/\(helixd_migration_manifest_too_large\)$/)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('refuses, unsent, a commit whose blob list pushes a fitting manifest past the frame', async () => {
    const manifest = manifestOfBytes(760 * 1024)
    await expect(
      commitRemoteHelixdMigrationCatalog(pairingCode, manifest, { expectedBlobs: manyBlobs })
    ).rejects.toThrow(/too large to move to its Helix server/)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('aborts a manifest no request can carry by its identity alone, durably', async () => {
    extraCapabilities.push(HELIXD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY)
    const manifest = manifestOfBytes(MAX_HELIXD_MIGRATION_MANIFEST_BYTES)
    const identity = { migrationId: manifest.migrationId, manifestSha256: manifest.manifestSha256 }
    sendRequest.mockResolvedValueOnce({
      ok: true,
      result: { ...identity, state: 'absent', aborted: true, durableAbsent: true }
    })
    await expect(
      abortRemoteHelixdMigrationCatalogByReference(pairingCode, manifest)
    ).resolves.toEqual({ ...identity, state: 'absent', aborted: true, durableAbsent: true })
    expect(sendRequest).toHaveBeenCalledWith(
      expect.anything(),
      'helixd.migration.abortCatalogByReference',
      identity
    )

    sendRequest.mockResolvedValueOnce({
      ok: true,
      result: { ...identity, state: 'absent', aborted: true }
    })
    await expect(
      abortRemoteHelixdMigrationCatalogByReference(pairingCode, manifest)
    ).rejects.toThrow('helixd_migration_catalog_abort_durability_invalid')
  })

  it('refuses, unsent, an abort by reference to a host that predates it', async () => {
    await expect(
      abortRemoteHelixdMigrationCatalogByReference(
        pairingCode,
        manifestOfBytes(MAX_HELIXD_MIGRATION_MANIFEST_BYTES)
      )
    ).rejects.toThrow(HELIXD_MIGRATION_DESTINATION_ABORT_BY_REFERENCE_UNSUPPORTED)
    expect(sendRequest).not.toHaveBeenCalled()
  })
})
