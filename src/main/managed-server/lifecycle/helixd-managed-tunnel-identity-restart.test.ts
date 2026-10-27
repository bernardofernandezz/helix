import { pairedRuntimeConnectionFromOffer } from '../../../shared/paired-runtime-connection'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodePairingOffer, parsePairingCode, type PairingOffer } from '../../../shared/pairing'
import {
  addEnvironmentFromPairingCode,
  listEnvironments,
  markEnvironmentUsed
} from '../../../shared/runtime-environment-store'
import type { KnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import { HelixRuntimeService } from '../../runtime/helix-runtime'
import { HelixRuntimeRpcServer } from '../../runtime/runtime-rpc'
import { verifyRuntimePairingIdentity } from '../../runtime/runtime-environment-identity-verification'
import { verifyManagedHelixdTunnelIdentity } from './helixd-managed-tunnel-identity'
import { getPreferredPairingOffer } from '../../../shared/runtime-environments'
import {
  addWslHostEnvironment,
  refreshWslHostPairing
} from '../../../shared/runtime-environment-wsl-host-store'
import { buildServePairingReadiness } from '../../server/serve-pairing-readiness'
import { WslHelixdConnectionManager } from '../../wsl/wsl-helixd-connection'

vi.mock('../../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([]),
  listWorktreesStrict: vi.fn().mockResolvedValue([])
}))

const servers: HelixRuntimeRpcServer[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()))
})

async function startHelixd(userDataPath: string): Promise<HelixRuntimeRpcServer> {
  const server = new HelixRuntimeRpcServer({
    runtime: new HelixRuntimeService(),
    userDataPath,
    enableWebSocket: true,
    wsPort: 0
  })
  await server.start()
  servers.push(server)
  return server
}

function pairingOffer(server: HelixRuntimeRpcServer): PairingOffer {
  const offer = server.createPairingOffer({ address: '127.0.0.1', name: 'Desktop A' })
  if (!offer.available) {
    throw new Error('pairing unavailable')
  }
  return parsePairingCode(offer.pairingUrl)!
}

function managedEnvironment(pairing: PairingOffer, runtimeId: string): KnownRuntimeEnvironment {
  return {
    id: 'env-1',
    name: 'Box server',
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
    runtimeId,
    preferredEndpointId: 'ws',
    endpoints: [
      {
        id: 'ws',
        kind: 'websocket',
        label: 'Box',
        endpoint: pairing.endpoint,
        deviceToken: pairing.deviceToken,
        publicKeyB64: pairing.publicKeyB64
      }
    ],
    connectionDependency: 'ssh-tunnel',
    helixdDeployment: {
      sshTargetId: 'box',
      sshTargetGeneration: 1,
      localPort: 46_768,
      remotePort: 6_768
    }
  }
}

function reachedThrough(pairing: PairingOffer, server: HelixRuntimeRpcServer): PairingOffer {
  const port = new URL(pairingOffer(server).endpoint).port
  const endpoint = new URL(pairing.endpoint)
  endpoint.port = port
  return { ...pairing, endpoint: endpoint.toString() }
}

describe('reopening a managed tunnel after helixd restarted elsewhere', () => {
  it('keeps the WSL caller across host and desktop restarts, until explicit re-pairing', async () => {
    const hostProfile = mkdtempSync(join(tmpdir(), 'helixd-wsl-host-'))
    const desktopProfile = mkdtempSync(join(tmpdir(), 'helixd-wsl-client-'))
    let server = await startHelixd(hostProfile)
    const connect = async () => {
      const manager = new WslHelixdConnectionManager({
        getPairingOffer: () => {
          const [saved] = listEnvironments(desktopProfile)
          return saved ? getPreferredPairingOffer(saved) : null
        },
        deployAndLaunch: async () => ({
          outcome: 'ready',
          distro: 'Ubuntu',
          distroId: null,
          fullVersion: '1',
          pid: null,
          holder: 'adopted',
          port: Number(new URL(server.getWebSocketEndpoint()!).port),
          readiness: {
            runtimeId: server['runtime'].getRuntimeId(),
            managedWslCliReconciliation: 'settled',
            ...(await buildServePairingReadiness({ pairingAddress: '127.0.0.1' }, server))
          }
        }),
        listen: async (_transport, { remotePort }) => ({
          entry: {
            id: 'bridge',
            connectionId: 'wsl:ubuntu',
            localPort: remotePort,
            remoteHost: '127.0.0.1',
            remotePort
          },
          close: async () => {},
          dispose: () => {}
        })
      })
      const dispatch = vi.spyOn(server['dispatcher'], 'dispatchStreaming')
      try {
        const connection = await manager.ensure('Ubuntu')
        return {
          connection,
          caller: dispatch.mock.calls.at(-1)?.[2]?.authenticatedCallerFingerprint
        }
      } finally {
        dispatch.mockRestore()
        await manager.dispose()
      }
    }
    const first = await connect()
    expect(first.caller).toBeTruthy()
    addWslHostEnvironment(desktopProfile, {
      id: 'wsl:ubuntu',
      name: 'Ubuntu',
      pairingCode: first.connection.pairingOffer,
      record: {
        kind: 'wsl',
        distro: 'Ubuntu',
        localPort: first.connection.localPort,
        remotePort: first.connection.remotePort
      }
    })
    await server.stop()
    server = await startHelixd(hostProfile)
    const restarted = await connect()
    expect(restarted.caller).toBe(first.caller)
    const paired = parsePairingCode(first.connection.pairingOffer)!
    server.getDeviceRegistry()!.removeDevice(paired.pairedDeviceId!)
    await expect(connect()).rejects.toThrow('helixd_pairing_rejected')
    refreshWslHostPairing(desktopProfile, 'wsl:ubuntu', {
      pairingCode: encodePairingOffer(pairingOffer(server)),
      localPort: restarted.connection.localPort,
      remotePort: restarted.connection.remotePort
    })
    const rePaired = await connect()
    expect(rePaired.caller).toBeTruthy()
    expect(rePaired.caller).not.toBe(first.caller)
  })

  it('accepts the same host under a new runtime id, and its status recovers', async () => {
    const hostProfile = mkdtempSync(join(tmpdir(), 'helixd-host-'))
    const first = await startHelixd(hostProfile)
    const paired = pairingOffer(first)
    const recorded = (
      await verifyRuntimePairingIdentity(pairedRuntimeConnectionFromOffer(paired), {
        runtimeId: null
      })
    ).verifiedRuntimeId
    await first.stop()

    const restarted = await startHelixd(hostProfile)
    const pairing = reachedThrough(paired, restarted)

    await expect(
      verifyManagedHelixdTunnelIdentity(managedEnvironment(pairing, recorded))
    ).resolves.toEqual({ verdict: 'verified' })
    // Authenticated status records the restarted process's new runtime ID.
    const status = await verifyRuntimePairingIdentity(pairedRuntimeConnectionFromOffer(pairing), {
      runtimeId: null
    })
    expect(status.verifiedRuntimeId).not.toBe(recorded)
    const desktopProfile = mkdtempSync(join(tmpdir(), 'desktop-a-'))
    const saved = addEnvironmentFromPairingCode(desktopProfile, {
      name: 'Box server',
      pairingCode: encodePairingOffer(pairing)
    })
    markEnvironmentUsed(desktopProfile, saved.id, { runtimeId: recorded })
    markEnvironmentUsed(desktopProfile, saved.id, {
      runtimeId: status.verifiedRuntimeId,
      pairingDeviceToken: pairing.deviceToken
    })
    expect(listEnvironments(desktopProfile)[0]?.runtimeId).toBe(status.verifiedRuntimeId)
  })

  it('still refuses a different host that answers on the tunnel', async () => {
    const paired = pairingOffer(await startHelixd(mkdtempSync(join(tmpdir(), 'helixd-host-'))))
    const other = await startHelixd(mkdtempSync(join(tmpdir(), 'helixd-other-')))

    await expect(
      verifyManagedHelixdTunnelIdentity(
        managedEnvironment(reachedThrough(paired, other), 'runtime-recorded')
      )
    ).resolves.toMatchObject({ verdict: 'foreign' })
  })
})
