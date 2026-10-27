import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPosixStdoutFence } from '../../shared/posix-stdout-fence'
import type { NodeRuntimeTarget } from '../../shared/node-runtime-pin'
import { initialHelixdActivationAdmissionCommand } from '../ssh/helixd-initial-activation-admission'
import {
  captureHelixdLaunchSshSessionCommand,
  helixdLaunchSshSessionProbeCommand,
  writeHelixdLaunchSshSessionCommand
} from '../ssh/helixd-launch-ssh-session'
import { makeExecStdinWriteFileCommand } from '../ssh/ssh-exec-stdin-file-transfer'
import { wrapRemoteCommandForPosixShell } from '../ssh/ssh-posix-command-wrapper'
import {
  listRemoteInstallBaseDirsCommand,
  moveRemoteTreeCommand,
  probeFileExistsCommand,
  probeRemoteInstallCompleteCommand,
  readRemoteHomeCommand,
  removeRemoteFileCommand,
  removeRemoteTreeCommand,
  restoreRemoteTreeCommand,
  writeRemoteEmptyFileCommand
} from '../ssh/ssh-remote-commands'
import { getRemoteHostPlatform, type RemoteHostPlatform } from '../ssh/ssh-remote-platform'
import { makePosixWriteFileCommand } from '../ssh/system-transport/system-ssh-file-binary-transfer'
import {
  posixHelixdFenceGuard,
  runWithHelixdFence,
  type HelixdFence
} from './activation/helixd-activation-fence-scope'
import { posixReleaseFenceCommand } from './activation/helixd-activation-lock'
import {
  captureHelixdStateSnapshotCommand,
  clearHelixdStateSnapshotMembersCommand,
  compareHelixdStateSnapshotCommand,
  probeHelixdStateSnapshotCommand,
  restoreHelixdStateSnapshotCommand,
  serializedStateMutationCommand
} from './host-state/helixd-state-snapshot'
import { newestStateMtimeCommand } from './host-state/helixd-state-newest-mtime'
import { helixdSnapshotSpaceCommand } from './host-state/helixd-state-snapshot-space'
import { posixProcessGroupCommand } from './host-state/helixd-state-mutation-owner-record'
import { helixdMachineClaimCommand } from './host-state/helixd-machine-claim-command'
import { helixdMachineHomeProbeCommand } from './host-state/helixd-machine-home'
import { executablePermissionsCommand } from './install/helixd-remote-install'
import {
  helixdNodeSlotRuntimeCommand,
  selectHelixdSlotEntryCommand,
  selectHelixdSlotRuntimeCommand
} from './install/helixd-remote-runtime'
import {
  helixdLaunchCommand,
  helixdLivenessProbeCommand,
  readHelixdReadinessCommand
} from './install/helixd-remote-launch'
import {
  createExecProbedStageCommand,
  installNodeRuntimeFromHostArchiveCommand,
  probeRemoteNodeRuntimeCommand,
  promoteRemoteNodeRuntimeCommand,
  recheckAndPromoteRemoteNodeRuntimeCommand,
  remoteNodeRuntimePresentCommand
} from './install/helixd-remote-node-runtime'
import { remoteSha256Command } from './install/remote-sha256-command'
import { hostDownloadNodeRuntimeCommand } from './install/remote-node-runtime-host-download'
import { remoteHelixdBuildHashCommand } from './install/helixd-remote-build-hash'
import { remoteFreeSpaceProbeCommand } from './install/remote-install-out-of-space'
import { sweepStaleRuntimeStagesCommand } from './install/remote-node-runtime-store-gc'
import { helixdProfilePreflightCommand } from './install/helixd-remote-preflight'
import {
  recordedNodeRuntimeProbeCommand,
  recordedRemoteNodeRuntimeProbeCommand
} from './install/helixd-remote-node-runtime-recorded-probe'
import { runtimeStoreInventoryCommand } from './install/remote-node-runtime-store-inventory'
import { posixReleaseOwnedLockCommand } from './install/remote-node-runtime-store-lock'
import { HELIXD_INSTALL_MODEL } from './install/remote-install-model'
import { stopHelixdCommand } from './install/helixd-remote-process-control'
import {
  acquireInstallLockParentCommand,
  lockAgeSecondsCommand,
  orphanInstallLockCommand,
  probeInstallLockExistsCommand,
  tryCreateInstallLockCommand,
  tryStealInstallLockCommand
} from './install/remote-install-lock-commands'
import { helixdLogTailCommand } from './install/helixd-remote-log-tail'
import {
  helixdReadinessWaitCommand,
  readHelixdReadinessNowCommand
} from './install/helixd-remote-readiness-wait'
import {
  helixdBashStdioBridgeCommand,
  helixdPosixStdioBridgeCommand
} from './lifecycle/helixd-stdio-bridge-script'

// Gateways truncate near 10 KB; bound uncompressed, fenced commands to 6 KB.
const POSIX_HOST_OP_BYTE_BUDGET = 6 * 1024

const OVER_BUDGET_CEILINGS: Readonly<Record<string, number>> = {
  tryStealInstallLockCommand: 9_072,
  helixdLaunchCommand: 7_029,
  // WSL-only: wsl.exe argv, never SSH-framed; carries the Node bridge as its fallback.
  helixdBashStdioBridgeCommand: 6_300
}

type HostCase = { host: RemoteHostPlatform; target: NodeRuntimeTarget; nodePath: string }

const home = `/net/nfs-home-cluster-03/users/engineering/${'a'.repeat(48)}.longname`
const baseDir = `${home}/.helix-remote`
const slotDir = `${baseDir}/helixd-1.4.299-rc.12+${'f'.repeat(40)}`
const userDataDir = `${baseDir}/helixd-data`
const snapshotDir = `${baseDir}/helixd-snapshots/pre-1.4.299-rc.12-1760000000000`
const installLock = `${slotDir}.install-lock`
const token = 'f'.repeat(64)
const fence: HelixdFence = { lockDir: `${baseDir}/helixd-activation.lock`, token }
const owner = { fileName: 'owner', token }

function hostCase(platform: 'linux-x64' | 'darwin-arm64', target: NodeRuntimeTarget): HostCase {
  const nodePath = `${baseDir}/node-runtimes/v22.20.0-${target}/bin/node`
  return { host: getRemoteHostPlatform(platform), target, nodePath }
}

const HOST_CASES: readonly HostCase[] = [
  hostCase('linux-x64', 'linux-x64-glibc'),
  hostCase('darwin-arm64', 'darwin-arm64')
]

function launchSpec(nodePath: string): Parameters<typeof helixdLaunchCommand>[1] {
  return {
    remoteInstallDir: slotDir,
    nodePath,
    fullVersion: '1.4.299-rc.12',
    userDataDir,
    bindHost: '127.0.0.1',
    port: 65535,
    activationRoot: `${baseDir}/helixd-activation`
  }
}

function promoteArgs({
  nodePath,
  target
}: HostCase): Parameters<typeof promoteRemoteNodeRuntimeCommand>[1] {
  return {
    stageDir: `${nodePath}.stage-${token}`,
    archive: `${baseDir}/node-runtimes/archive.tar.xz`,
    runtimeDir: nodePath,
    target,
    token
  }
}

const BUILDERS: Readonly<Record<string, (c: HostCase) => string>> = {
  serializedStateMutationCommand: () => serializedStateMutationCommand(baseDir, ':', 20, fence),
  captureHelixdStateSnapshotCommand: ({ host }) =>
    captureHelixdStateSnapshotCommand(host, userDataDir, snapshotDir, baseDir, {
      snapshotsRoot: `${baseDir}/helixd-snapshots`,
      keep: [snapshotDir.slice(snapshotDir.lastIndexOf('/') + 1), 'pre-1.4.298-rc.3-1750000000000']
    }),
  probeHelixdStateSnapshotCommand: ({ host }) =>
    probeHelixdStateSnapshotCommand(host, snapshotDir, baseDir),
  restoreHelixdStateSnapshotCommand: ({ host }) =>
    restoreHelixdStateSnapshotCommand(host, userDataDir, snapshotDir, baseDir),
  clearHelixdStateSnapshotMembersCommand: ({ host }) =>
    clearHelixdStateSnapshotMembersCommand(host, userDataDir, baseDir),
  compareHelixdStateSnapshotCommand: ({ host }) =>
    compareHelixdStateSnapshotCommand(host, userDataDir, snapshotDir, baseDir),
  newestStateMtimeCommand: ({ host }) => newestStateMtimeCommand(host, userDataDir, baseDir),
  helixdSnapshotSpaceCommand: ({ host }) =>
    helixdSnapshotSpaceCommand(host, userDataDir, snapshotDir, baseDir, ['keep-a', 'keep-b']) ?? '',
  posixProcessGroupCommand: () => posixProcessGroupCommand('"$pid"'),
  helixdMachineClaimCommand: ({ host }) => helixdMachineClaimCommand(host, home, 'k'.repeat(64)),
  helixdMachineHomeProbeCommand: ({ host }) => helixdMachineHomeProbeCommand(host),
  selectHelixdSlotEntryCommand: ({ host }) => selectHelixdSlotEntryCommand(host, slotDir),
  helixdNodeSlotRuntimeCommand: ({ host }) => helixdNodeSlotRuntimeCommand(host, slotDir),
  selectHelixdSlotRuntimeCommand: ({ host, nodePath }) =>
    selectHelixdSlotRuntimeCommand(host, slotDir, nodePath),
  // macOS launch embeds SSH-session capture and attribution records.
  helixdLaunchCommand: ({ host, nodePath }) =>
    helixdLaunchCommand(host, launchSpec(nodePath), 'nohup', []),
  'helixdLaunchCommand (WSL setsid)': ({ host, nodePath }) =>
    helixdLaunchCommand(host, launchSpec(nodePath), 'setsid', [
      ['HELIX_EXAMPLE_HOST_ENV', 'x'.repeat(200)]
    ]),
  readHelixdReadinessCommand: ({ host }) => readHelixdReadinessCommand(host, slotDir),
  helixdLivenessProbeCommand: ({ host }) => helixdLivenessProbeCommand(host, slotDir),
  remoteSha256Command: ({ nodePath }) => remoteSha256Command(`'${nodePath}'`),
  remoteFreeSpaceProbeCommand: ({ nodePath }) => remoteFreeSpaceProbeCommand(nodePath),
  hostDownloadNodeRuntimeCommand: ({ host, nodePath, target }) =>
    hostDownloadNodeRuntimeCommand(host, { stageDir: `${nodePath}.stage-${token}`, target }),
  createExecProbedStageCommand: ({ host, nodePath }) =>
    createExecProbedStageCommand(host, `${nodePath}.stage-${token}`),
  probeRemoteNodeRuntimeCommand: ({ host, nodePath, target }) =>
    probeRemoteNodeRuntimeCommand(host, nodePath, target),
  remoteNodeRuntimePresentCommand: ({ host, nodePath }) =>
    remoteNodeRuntimePresentCommand(host, nodePath, true),
  promoteRemoteNodeRuntimeCommand: (c) => promoteRemoteNodeRuntimeCommand(c.host, promoteArgs(c)),
  recheckAndPromoteRemoteNodeRuntimeCommand: (c) =>
    recheckAndPromoteRemoteNodeRuntimeCommand(c.host, promoteArgs(c)),
  installNodeRuntimeFromHostArchiveCommand: ({ host, nodePath, target }) =>
    installNodeRuntimeFromHostArchiveCommand(host, {
      runtimeDir: nodePath,
      archive: `${baseDir}/node-runtimes/archive.tar.xz`,
      target,
      token
    }),
  remoteHelixdBuildHashCommand: ({ host }) => remoteHelixdBuildHashCommand(host, slotDir),
  sweepStaleRuntimeStagesCommand: ({ host }) =>
    sweepStaleRuntimeStagesCommand(`${baseDir}/node-runtimes`, host),
  helixdProfilePreflightCommand: ({ host }) => helixdProfilePreflightCommand(host, slotDir, token),
  recordedNodeRuntimeProbeCommand: ({ host, nodePath }) =>
    recordedNodeRuntimeProbeCommand(host, nodePath, token),
  recordedRemoteNodeRuntimeProbeCommand: ({ host, nodePath, target }) =>
    recordedRemoteNodeRuntimeProbeCommand(host, nodePath, target),
  runtimeStoreInventoryCommand: ({ host }) => runtimeStoreInventoryCommand(host, home),
  stopHelixdCommand: ({ host, nodePath }) =>
    stopHelixdCommand(host, slotDir, { waitSeconds: 30, nodePath }),
  acquireInstallLockParentCommand: ({ host }) => acquireInstallLockParentCommand(host, baseDir),
  tryCreateInstallLockCommand: ({ host }) => tryCreateInstallLockCommand(host, installLock, owner),
  probeInstallLockExistsCommand: ({ host }) => probeInstallLockExistsCommand(host, installLock),
  lockAgeSecondsCommand: ({ host }) => lockAgeSecondsCommand(host, installLock),
  orphanInstallLockCommand: ({ host }) => orphanInstallLockCommand(host, installLock),
  tryStealInstallLockCommand: ({ host }) =>
    tryStealInstallLockCommand(host, installLock, 120, owner, {
      ...owner,
      quietSeconds: 60,
      mutationLock: `${baseDir}/helixd-state-mutation.lock`
    }),
  helixdLogTailCommand: ({ host }) => helixdLogTailCommand(host, slotDir),
  helixdReadinessWaitCommand: ({ host }) => helixdReadinessWaitCommand(host, slotDir, 120),
  readHelixdReadinessNowCommand: ({ host }) => readHelixdReadinessNowCommand(host, slotDir),
  helixdPosixStdioBridgeCommand: () => helixdPosixStdioBridgeCommand(65535),
  helixdBashStdioBridgeCommand: () => helixdBashStdioBridgeCommand(65535),
  posixReleaseFenceCommand: () =>
    posixReleaseFenceCommand(
      fence,
      `${baseDir}/helixd-activation/journal.json`,
      `${baseDir}/helixd-activation`
    ),
  posixReleaseOwnedLockCommand: ({ host }) =>
    `${posixReleaseOwnedLockCommand(host, `${baseDir}/node-runtimes/.store-lock`, owner)} || true`,
  executablePermissionsCommand: ({ host, target }) =>
    executablePermissionsCommand(host, slotDir, target),
  readRemoteHomeCommand: ({ host }) => readRemoteHomeCommand(host),
  removeRemoteFileCommand: ({ host }) => removeRemoteFileCommand(host, `${slotDir}/.helixd-pid`),
  removeRemoteTreeCommand: ({ host }) => removeRemoteTreeCommand(host, slotDir),
  moveRemoteTreeCommand: ({ host }) =>
    moveRemoteTreeCommand(host, slotDir, `${slotDir}.trash-${token}`),
  restoreRemoteTreeCommand: ({ host }) =>
    restoreRemoteTreeCommand(host, `${slotDir}.trash-${token}`, slotDir),
  writeRemoteEmptyFileCommand: ({ host }) =>
    writeRemoteEmptyFileCommand(host, `${slotDir}/.complete`),
  probeRemoteInstallCompleteCommand: ({ host }) =>
    probeRemoteInstallCompleteCommand(host, slotDir, [
      ...HELIXD_INSTALL_MODEL.requiredArtifacts(host),
      HELIXD_INSTALL_MODEL.installCompleteFilename
    ]),
  listRemoteInstallBaseDirsCommand: ({ host }) =>
    listRemoteInstallBaseDirsCommand(host, baseDir, HELIXD_INSTALL_MODEL),
  probeFileExistsCommand: ({ host }) => probeFileExistsCommand(host, `${slotDir}/.complete`),
  captureHelixdLaunchSshSessionCommand: () => captureHelixdLaunchSshSessionCommand(),
  writeHelixdLaunchSshSessionCommand: ({ host }) =>
    writeHelixdLaunchSshSessionCommand(host, userDataDir),
  helixdLaunchSshSessionProbeCommand: ({ host }) =>
    helixdLaunchSshSessionProbeCommand(host, slotDir, userDataDir),
  initialHelixdActivationAdmissionCommand: ({ host, nodePath }) =>
    initialHelixdActivationAdmissionCommand(host, userDataDir, slotDir, nodePath),
  makeExecStdinWriteFileCommand: () =>
    makeExecStdinWriteFileCommand(`${slotDir}/helixd.js`, Number.MAX_SAFE_INTEGER, {
      token,
      executable: true
    }),
  makePosixWriteFileCommand: () =>
    makePosixWriteFileCommand(`${slotDir}/helixd.js`, { exclusive: true })
}

const NOT_POSIX_HOST_OPS: Readonly<Record<string, string>> = {
  powerShellCommand: 'builds the Windows PowerShell exec line',
  spawnProxyCommand: 'spawns a local ProxyCommand process',
  buildSshLoginShellCommand: 'wraps a caller-built op in the login shell',
  isSnapshotCaptureCommand: 'a predicate over a command, not a builder',
  execCommand: 'the exec entry point every measured op goes through',
  execHostCommand: 'the exec entry point every measured op goes through',
  spawnSystemSshCommand: 'spawns the local ssh client'
}

// Legacy relay retires 2027-01-15; exclude its host operations.
const SCANNED_DIRS = [
  ...['host-state', 'install', 'lifecycle', 'activation'].map((dir) => join(__dirname, dir)),
  join(__dirname, '..', 'ssh'),
  ...['system-transport', 'connection', 'remote-exec'].map((dir) =>
    join(__dirname, '..', 'ssh', dir)
  )
]

function exportedCommandBuilders(): string[] {
  const names: string[] = []
  for (const root of SCANNED_DIRS) {
    for (const file of readdirSync(root)) {
      if (
        !file.endsWith('.ts') ||
        /\.test(-fixture)?\.ts$/.test(file) ||
        file.endsWith('.spec.ts')
      ) {
        continue
      }
      if (/windows/i.test(file)) {
        continue
      }
      const source = readFileSync(join(root, file), 'utf8')
      for (const match of source.matchAll(/^export (?:async )?function (\w+Command)\(/gm)) {
        names.push(match[1])
      }
    }
  }
  return names.sort()
}

// Measure the largest POSIX command, including guards even for optionally fenced operations.
async function sentBytes(build: (c: HostCase) => string): Promise<number> {
  let max = 0
  for (const c of HOST_CASES) {
    const command = await runWithHelixdFence(fence, async () => build(c))
    // Match exec stdout framing; real nonces are at most 16 characters.
    const framed = buildPosixStdoutFence(
      `${posixHelixdFenceGuard(fence)} ${command}`,
      'SSH',
      'z'.repeat(16)
    ).command
    const sent = wrapRemoteCommandForPosixShell(framed, { compress: false })
    max = Math.max(max, Buffer.byteLength(sent, 'utf8'))
  }
  return max
}

describe('POSIX host-op byte budget', () => {
  it('measures every exported POSIX host-op builder', () => {
    const unmeasured = exportedCommandBuilders().filter(
      (name) => !(name in BUILDERS) && !(name in NOT_POSIX_HOST_OPS)
    )
    expect(unmeasured).toEqual([])
  })

  it.each(Object.keys(BUILDERS))('%s stays under the sent byte budget', async (name) => {
    const bytes = await sentBytes(BUILDERS[name])
    const ceiling = OVER_BUDGET_CEILINGS[name]
    if (ceiling === undefined) {
      expect(bytes).toBeLessThanOrEqual(POSIX_HOST_OP_BYTE_BUDGET)
      return
    }
    expect(bytes).toBeGreaterThan(POSIX_HOST_OP_BYTE_BUDGET)
    expect(bytes).toBeLessThanOrEqual(ceiling)
  })
})
