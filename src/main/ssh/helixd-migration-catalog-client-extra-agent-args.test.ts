import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HELIXD_MIGRATION_MANIFEST_VERSION } from '../../shared/helixd-migration/helixd-migration-manifest-validation'
import type { HelixdMigrationManifest } from '../../shared/helixd-migration/helixd-migration-manifest'
import { computeHelixdMigrationManifestSha256 } from '../helixd/helixd-migration-manifest-digest'
import { DORMANT_AUTOMATION } from '../persistence/migrating-helixd-catalog/persistence-helixd-migration-catalog-fixture'
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../shared/pairing'
import { AUTOMATION_EXTRA_AGENT_ARGS_RUNTIME_CAPABILITY } from '../../shared/protocol-version'

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
  readRemoteHelixdMigrationCatalogState,
  stageRemoteHelixdMigrationCatalog
} = await import('./helixd-migration-catalog-client')

function manifest(extraAgentArgs?: string): HelixdMigrationManifest {
  const unsigned = {
    version: HELIXD_MIGRATION_MANIFEST_VERSION,
    migrationId: 'migration-1',
    createdAt: '2026-08-30T12:00:00.000Z',
    source: {
      sshTargetId: 'ssh-prod',
      sshTargetGeneration: 7,
      targetLabel: 'Production'
    },
    payload: {
      repositories: [],
      projectGroups: [],
      folderWorkspaces: [],
      dormantState: {
        version: 1 as const,
        worktreeMeta: [],
        worktreeLineage: [],
        workspaceLineage: [],
        sparsePresets: [],
        retiredWorktreeNames: [],
        retiredWorktreeNamespaces: [],
        automations: [{ ...DORMANT_AUTOMATION, ...(extraAgentArgs ? { extraAgentArgs } : {}) }]
      }
    }
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

describe('helixd migration of automations with extra agent args', () => {
  it.each([stageRemoteHelixdMigrationCatalog, commitRemoteHelixdMigrationCatalog])(
    'refuses a destination without the capability before sending',
    async (request) => {
      await expect(request(pairingCode, manifest('--model opus'))).rejects.toThrow(
        'helixd_migration_destination_extra_agent_args_unsupported'
      )
      expect(sendRequest).not.toHaveBeenCalled()
    }
  )

  it('still reads state and aborts on such a destination', async () => {
    sendRequest.mockResolvedValue({ ok: false, error: { code: 'x', message: 'stop' } })
    for (const request of [
      readRemoteHelixdMigrationCatalogState,
      abortRemoteHelixdMigrationCatalog
    ]) {
      await expect(request(pairingCode, manifest('--model opus'))).rejects.toThrow('stop')
    }
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('sends when the destination advertises the capability or no automation has extras', async () => {
    sendRequest.mockResolvedValue({ ok: false, error: { code: 'x', message: 'sent' } })
    await expect(stageRemoteHelixdMigrationCatalog(pairingCode, manifest())).rejects.toThrow('sent')
    status.capabilities = [...status.capabilities, AUTOMATION_EXTRA_AGENT_ARGS_RUNTIME_CAPABILITY]
    await expect(
      stageRemoteHelixdMigrationCatalog(pairingCode, manifest('--model opus'))
    ).rejects.toThrow('sent')
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })
})
