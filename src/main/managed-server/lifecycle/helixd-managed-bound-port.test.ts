import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'

const execHelixdRemote = vi.hoisted(() => vi.fn())
vi.mock('../install/helixd-remote-runtime-control', () => ({ execHelixdRemote }))
const resolveHelixdRemoteContext = vi.hoisted(() => vi.fn())
vi.mock('../install/helixd-remote-context', () => ({ resolveHelixdRemoteContext }))

import { helixdBoundPort, resolveManagedHelixdTunnelPort } from './helixd-managed-bound-port'
import type { KnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import type { SshTarget } from '../../../shared/ssh-types'
import { unusedHelixdHostTransport } from '../../ssh/unused-host-transport.test-fixture'

function readinessLine(boundEndpoint: string | null): string {
  return `${JSON.stringify({ type: 'helix_server_ready', runtimeId: 'runtime-1', boundEndpoint })}\n`
}

describe('helixdBoundPort', () => {
  it('reads the port helixd actually bound', () => {
    expect(helixdBoundPort({ boundEndpoint: 'ws://127.0.0.1:58520' })).toBe(58_520)
  })

  it.each([null, 'not a url', 'ws://127.0.0.1'])('returns null for %s', (boundEndpoint) => {
    expect(helixdBoundPort({ boundEndpoint })).toBeNull()
  })
})

describe('resolveManagedHelixdTunnelPort', () => {
  const link = {
    sshTargetId: 'ssh-1',
    sshTargetGeneration: 1,
    localPort: 46_768,
    remotePort: 6_768
  }
  function input(kind: 'helixdDeployment' | 'sshAccess') {
    return {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only the link fields.
      environment: { [kind]: link } as unknown as KnownRuntimeEnvironment,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: passed through to the mocked context.
      target: { id: 'ssh-1' } as SshTarget,
      connection: unusedHelixdHostTransport()
    }
  }

  beforeEach(() => {
    execHelixdRemote.mockReset()
    resolveHelixdRemoteContext.mockReset()
  })

  it('reads the active slot of a managed server', async () => {
    resolveHelixdRemoteContext.mockResolvedValue({
      activationRecord: { active: '1.0.0+abc' },
      connection: {},
      host: getRemoteHostPlatform('linux-x64'),
      remoteHome: '/home/deploy'
    })
    execHelixdRemote.mockResolvedValue(readinessLine('ws://127.0.0.1:58520'))
    await expect(resolveManagedHelixdTunnelPort(input('helixdDeployment'))).resolves.toBe(58_520)
  })

  it.each([
    ['no readiness file', ''],
    ['a readiness without an endpoint', readinessLine(null)]
  ])('falls back to the preferred port for %s (older builds)', async (_label, output) => {
    resolveHelixdRemoteContext.mockResolvedValue({
      activationRecord: { active: '1.0.0+abc' },
      connection: {},
      host: getRemoteHostPlatform('linux-x64'),
      remoteHome: '/home/deploy'
    })
    execHelixdRemote.mockResolvedValue(output)
    await expect(resolveManagedHelixdTunnelPort(input('helixdDeployment'))).resolves.toBe(6_768)
  })

  it('keeps the configured port for independent SSH access without touching the host', async () => {
    await expect(resolveManagedHelixdTunnelPort(input('sshAccess'))).resolves.toBe(6_768)
    expect(resolveHelixdRemoteContext).not.toHaveBeenCalled()
  })

  it('tries the preferred port when the host cannot be read; the identity check still guards it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    resolveHelixdRemoteContext.mockRejectedValue(new Error('platform probe failed'))
    await expect(resolveManagedHelixdTunnelPort(input('helixdDeployment'))).resolves.toBe(6_768)
    warn.mockRestore()
  })
})
