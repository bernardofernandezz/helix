// Preferred ports may belong to other runtimes; tunnel to the active slot's published bound port.
import {
  getRuntimeSshAccess,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import type { SshTarget } from '../../../shared/ssh-types'
import type { ServeReadiness } from '../../server/serve-readiness'
import { managedHelixdInstallDir } from './helixd-managed-runtime-context'
import { resolveHelixdRemoteContext } from '../install/helixd-remote-context'
import {
  parseHelixdReadinessWaitOutput,
  readHelixdReadinessNowCommand
} from '../install/helixd-remote-readiness-wait'
import {
  execHelixdRemote,
  type HelixdRemoteExecTarget
} from '../install/helixd-remote-runtime-control'
import type { HelixdHostTarget, HelixdHostTransport } from '../../ssh/helixd-host-transport'

export type HelixdTunnelPortInput = {
  environment: KnownRuntimeEnvironment
  target: SshTarget
  connection: HelixdHostTransport
}

export function helixdBoundPort(readiness: Pick<ServeReadiness, 'boundEndpoint'>): number | null {
  if (!readiness.boundEndpoint) {
    return null
  }
  try {
    const port = Number(new URL(readiness.boundEndpoint).port)
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null
  } catch {
    return null
  }
}

async function readManagedHelixdSlotReadiness(
  target: HelixdRemoteExecTarget & { remoteInstallDir: string }
): Promise<ServeReadiness | null> {
  const parsed = parseHelixdReadinessWaitOutput(
    target.host,
    await execHelixdRemote(
      target,
      readHelixdReadinessNowCommand(target.host, target.remoteInstallDir)
    )
  )
  return parsed.state === 'ready' ? parsed.readiness : null
}

export async function readActiveManagedHelixdReadiness(input: {
  target: HelixdHostTarget
  connection: HelixdHostTransport
}): Promise<ServeReadiness | null> {
  const context = await resolveHelixdRemoteContext(input.target, input.connection)
  const active = context.activationRecord.active
  if (!active) {
    return null
  }
  return readManagedHelixdSlotReadiness({
    conn: context.connection,
    host: context.host,
    remoteHome: context.remoteHome,
    remoteInstallDir: managedHelixdInstallDir(context, active)
  })
}

async function readActiveSlotBoundPort(input: HelixdTunnelPortInput): Promise<number | null> {
  if (!input.environment.helixdDeployment) {
    return null
  }
  const readiness = await readActiveManagedHelixdReadiness(input)
  return readiness ? helixdBoundPort(readiness) : null
}

export async function resolveManagedHelixdTunnelPort(
  input: HelixdTunnelPortInput
): Promise<number> {
  const access = getRuntimeSshAccess(input.environment)
  if (!access) {
    throw new Error('Managed helixd environment is missing its SSH tunnel dependency.')
  }
  try {
    return (await readActiveSlotBoundPort(input)) ?? access.remotePort
  } catch (error) {
    // Post-forward identity validation still detects a wrong server when falling back.
    console.warn(
      '[ssh] Could not read the managed Helix server port; trying the preferred one:',
      error
    )
    return access.remotePort
  }
}

/** Missing or unreadable published ports never justify moving an existing tunnel. */
export async function readManagedHelixdPublishedPort(
  input: HelixdTunnelPortInput
): Promise<number | null> {
  try {
    return await readActiveSlotBoundPort(input)
  } catch {
    return null
  }
}
