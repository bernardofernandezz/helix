import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import type { SshTarget } from '../../../shared/ssh-types'
import type { HelixdActivationRecord } from '../activation/helixd-activation-record'
import { readHelixdActivationRecord } from '../activation/helixd-activation-record-store'
import { resolveHelixdRuntimeTarget } from '../lifecycle/helixd-runtime-target'
import { prepareWindowsHelixdHost } from '../host-state/helixd-windows-host-preparation'
import {
  isWslHelixdHostTarget,
  type HelixdHostTarget,
  type HelixdHostTransport
} from '../../ssh/helixd-host-transport'
import {
  decideHelixdMachineHome,
  helixdMachineDataRoot,
  helixdMachineHomeDir,
  helixdMachineHomeProbeCommand,
  helixdMachineOwnershipUnresolvedMessage,
  parseHelixdMachineHomeProbe
} from '../host-state/helixd-machine-home'
import {
  helixdMachineClaimCommand,
  readHelixdMachineClaimAnswer
} from '../host-state/helixd-machine-claim-command'
import { execHelixdRemote, type HelixdRemoteExecTarget } from './helixd-remote-runtime-control'
import { readRemoteHomeCommand } from '../../ssh/ssh-remote-commands'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  normalizeRemoteHome,
  validateRemoteHome,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import { detectRemoteHostPlatform } from '../../ssh/ssh-remote-platform-detection'
import { HelixdHostUnsupportedError } from '../../helixd/helixd-host-unavailable'
import { rememberSshHostPlatform } from '../../ssh/ssh-host-platform-memo'

/** Default SSH generic retains compatibility with lifecycle consumers requiring SSH-only fields. */
export type HelixdRemoteContext<Target extends HelixdHostTarget = SshTarget> = {
  activationRecord: HelixdActivationRecord
  /** Select a compatible runtime when host glibc is below the default pin's floor. */
  serverTarget: NodeRuntimeTarget
  connection: HelixdHostTransport
  host: RemoteHostPlatform
  /** Login or machine-specific home for shared-home isolation; userDataDir must follow the same owner. */
  remoteHome: string
  target: Target
  userDataDir: string
}

export async function resolveHelixdRemoteContext<Target extends HelixdHostTarget = SshTarget>(
  target: Target,
  connection: HelixdHostTransport,
  signal?: AbortSignal,
  detectedHost?: RemoteHostPlatform
): Promise<HelixdRemoteContext<Target>> {
  const host = detectedHost ?? (await detectRemoteHostPlatform(connection, { signal }))
  if (!host) {
    throw new HelixdHostUnsupportedError('Helix’s server doesn’t support this SSH host’s platform.')
  }
  const remote = { conn: connection, host, signal }
  const { helixdHome: remoteHome, userDataDir } = await resolveHelixdMachineHome(
    remote,
    !isWslHelixdHostTarget(target)
  )
  const serverTarget = await resolveHelixdRuntimeTarget({
    conn: connection,
    host,
    signal
  })
  if (!isWslHelixdHostTarget(target)) {
    rememberSshHostPlatform(target.id, host, serverTarget)
  }
  if (isWindowsRemoteHost(host)) {
    // Prepare pinned Node before even reading activation state on Windows.
    await prepareWindowsHelixdHost({
      conn: connection,
      host,
      remoteHome,
      serverTarget,
      signal
    })
  }
  const activationRecord = await readHelixdActivationRecord({
    ...remote,
    remoteHome
  })
  return {
    activationRecord,
    serverTarget,
    connection,
    host,
    remoteHome,
    target,
    userDataDir
  }
}

/** Resolve per-machine state for shared POSIX homes; Windows and WSL retain login-home placement. */
export async function resolveHelixdMachineHome(
  remote: HelixdRemoteExecTarget,
  keyByMachine: boolean
): Promise<{ loginHome: string; helixdHome: string; userDataDir: string }> {
  const { host } = remote
  if (!keyByMachine || isWindowsRemoteHost(host)) {
    const loginHome = normalizeRemoteHome(
      await execHelixdRemote(remote, readRemoteHomeCommand(host)),
      host
    )
    if (!validateRemoteHome(loginHome, host)) {
      throw new Error(`Remote home is not a valid path: ${loginHome.slice(0, 100)}`)
    }
    return {
      loginHome,
      helixdHome: loginHome,
      userDataDir: joinRemotePath(host, loginHome, '.helix')
    }
  }
  const probe = parseHelixdMachineHomeProbe(
    await execHelixdRemote(remote, helixdMachineHomeProbeCommand(host)),
    host
  )
  const { loginHome } = probe
  let decision = decideHelixdMachineHome(probe, host)
  if (decision.kind === 'unresolved') {
    throw new Error(
      helixdMachineOwnershipUnresolvedMessage(
        decision.machineKey,
        probe.identity?.hostname ?? null,
        decision.cause
      )
    )
  }
  if (decision.kind === 'claim') {
    const won = readHelixdMachineClaimAnswer(
      await execHelixdRemote(
        remote,
        helixdMachineClaimCommand(host, loginHome, decision.machineKey)
      )
    )
    if (won.state !== 'present') {
      throw new Error(won.message)
    }
    decision =
      won.machineKey === decision.machineKey
        ? { kind: 'login-home' }
        : { kind: 'machine-home', machineKey: decision.machineKey }
  }
  if (decision.kind === 'login-home') {
    return {
      loginHome,
      helixdHome: loginHome,
      userDataDir: joinRemotePath(host, loginHome, '.helix')
    }
  }
  const helixdHome = helixdMachineHomeDir(host, loginHome, decision.machineKey)
  await execHelixdRemote(remote, `umask 077; mkdir -p ${quotePosixShell(helixdHome)}`)
  return {
    loginHome,
    helixdHome,
    userDataDir: helixdMachineDataRoot(host, loginHome, decision.machineKey)
  }
}
