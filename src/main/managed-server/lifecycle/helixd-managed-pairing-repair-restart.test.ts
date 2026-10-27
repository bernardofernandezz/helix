import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parsePairingCode, type PairingOffer } from '../../../shared/pairing'
import { pairedRuntimeConnectionFromOffer } from '../../../shared/paired-runtime-connection'
import {
  createEnvironmentFromPairingOffer,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import type { SshTarget } from '../../../shared/ssh-types'
import { DeviceRegistry } from '../../runtime/device-registry'
import { HelixRuntimeService } from '../../runtime/helix-runtime'
import { HelixRuntimeRpcServer } from '../../runtime/runtime-rpc'
import { verifyRuntimePairingIdentity } from '../../runtime/runtime-environment-identity-verification'
import { buildServePairingReadiness } from '../../server/serve-pairing-readiness'
import type { ServeReadiness } from '../../server/serve-readiness'
import { ManagedHelixdPairingRepairs } from './helixd-managed-pairing-repair'
import {
  HelixdManagedIdentityError,
  verifyManagedHelixdTunnelIdentity
} from './helixd-managed-tunnel-identity'
import { unusedHelixdHostTransport } from '../../ssh/unused-host-transport.test-fixture'

vi.mock('../../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([]),
  listWorktreesStrict: vi.fn().mockResolvedValue([])
}))

const servers: HelixRuntimeRpcServer[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()))
})

async function startHelixd(hostProfile: string): Promise<HelixRuntimeRpcServer> {
  const server = new HelixRuntimeRpcServer({
    runtime: new HelixRuntimeService(),
    userDataPath: hostProfile,
    enableWebSocket: true,
    wsPort: 0
  })
  await server.start()
  servers.push(server)
  return server
}

async function publishedReadiness(server: HelixRuntimeRpcServer): Promise<ServeReadiness> {
  return {
    runtimeId: 'runtime-now',
    managedWslCliReconciliation: 'settled',
    ...(await buildServePairingReadiness({ pairingAddress: '127.0.0.1' }, server))
  }
}

function offerIn(readiness: ServeReadiness): PairingOffer {
  if (!readiness.pairing.available) {
    throw new Error('pairing unavailable')
  }
  return parsePairingCode(readiness.pairing.url)!
}

function savedEnvironment(offer: PairingOffer, at = 1): KnownRuntimeEnvironment {
  return {
    ...createEnvironmentFromPairingOffer({
      id: 'env-1',
      name: 'Box server',
      now: at,
      offer,
      connectionDependency: 'ssh-tunnel'
    }),
    helixdDeployment: {
      sshTargetId: 'box',
      sshTargetGeneration: 1,
      localPort: Number(new URL(offer.endpoint).port),
      remotePort: 6_768
    }
  }
}

function repairsAgainst(saved: KnownRuntimeEnvironment, readiness: ServeReadiness) {
  let current = saved
  const refresh = vi.fn((_id: string, code: string) => {
    current = savedEnvironment(parsePairingCode(code)!, 2)
    return current
  })
  const repairs = new ManagedHelixdPairingRepairs({
    resolve: () => current,
    connect: async () => ({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only passed to readReadiness, which ignores it here.
      target: {} as SshTarget,
      connection: unusedHelixdHostTransport()
    }),
    readReadiness: async () => readiness,
    refresh,
    repaired: vi.fn(),
    now: () => 0
  })
  return { repairs, refresh }
}

describe('a managed helixd that dropped this desktop and restarted', () => {
  it('reads as our server refusing our token, and pairing again over SSH restores access', async () => {
    const hostProfile = mkdtempSync(join(tmpdir(), 'helixd-host-'))
    const first = await startHelixd(hostProfile)
    const paired = offerIn(await publishedReadiness(first))
    await verifyRuntimePairingIdentity(pairedRuntimeConnectionFromOffer(paired), {
      runtimeId: null
    })
    await first.stop()
    new DeviceRegistry(hostProfile).removeDevice(paired.pairedDeviceId!)
    const restarted = await startHelixd(hostProfile)
    const readiness = await publishedReadiness(restarted)
    const reached = { ...paired, endpoint: offerIn(readiness).endpoint }

    const refused = await verifyManagedHelixdTunnelIdentity(savedEnvironment(reached))
    // The pinned key sealed this refusal, proving the expected server answered.
    expect(refused.verdict).toBe('unpaired')

    const { repairs, refresh } = repairsAgainst(savedEnvironment(reached), readiness)
    const repaired = await repairs.repair('env-1', 1)
    expect(refresh).toHaveBeenCalledOnce()
    await expect(verifyManagedHelixdTunnelIdentity(repaired)).resolves.toEqual({
      verdict: 'verified'
    })
  })

  it('never pairs with a server whose key differs from the pinned one', async () => {
    const paired = offerIn(
      await publishedReadiness(await startHelixd(mkdtempSync(join(tmpdir(), 'helixd-host-'))))
    )
    const other = await publishedReadiness(
      await startHelixd(mkdtempSync(join(tmpdir(), 'helixd-other-')))
    )
    const reached = { ...paired, endpoint: offerIn(other).endpoint }
    await expect(
      verifyManagedHelixdTunnelIdentity(savedEnvironment(reached))
    ).resolves.toMatchObject({ verdict: 'foreign' })

    const { repairs, refresh } = repairsAgainst(savedEnvironment(reached), other)
    await expect(repairs.repair('env-1', 1)).rejects.toBeInstanceOf(HelixdManagedIdentityError)
    expect(refresh).not.toHaveBeenCalled()
  })
})
