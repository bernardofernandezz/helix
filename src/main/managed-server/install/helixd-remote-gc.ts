// GC only helixd-owned slots; pin active, rollback, live-daemon and journal versions, skipping collection when recovery state is unreadable.
import type { HelixdHostTransport } from '../../ssh/helixd-host-transport'
import {
  execCommand,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import { HELIXD_INSTALL_MODEL } from './remote-install-model'
import { gcOldRemoteInstallVersions } from './remote-install-gc'
import {
  helixdGcPinnedDirNames,
  type HelixdActivationRecord
} from '../activation/helixd-activation-record'
import {
  HELIXD_NEVER_LAUNCHED,
  helixdLivenessAnswerBlocksGc,
  helixdLivenessProbeCommand
} from './helixd-remote-launch'
import { gcRemoteNodeRuntimeStore } from './remote-node-runtime-store-gc'
import { readHelixdGcTransactionPins } from '../../ssh/helixd-gc-transaction-pins'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import { RELAY_REMOTE_DIR } from '../../ssh/remote-exec/remote-frame-protocol'
import { helixdWindowsHomeOpCommand } from './helixd-remote-windows-node'
import { HELIXD_WINDOWS_LIVENESS_MANY_MARKER } from '../host-state/helixd-windows-host-script'

type HelixdGcOptions = {
  conn: HelixdHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  currentDirAbsPath: string
  record: HelixdActivationRecord
  /** A live daemon can still execute an outgoing bundle no longer active or previous; keep its bytes. */
  liveDaemonVersion?: string | null
  /** Current executable hashes both pin runtimes and authorize runtime-store GC. */
  nodeRuntimePins?: readonly string[]
  signal?: AbortSignal
}

export async function gcOldHelixdVersions(options: HelixdGcOptions): Promise<void> {
  const transaction = await readHelixdGcTransactionPins(options)
  if (transaction.state === 'keep-all') {
    console.warn('[helixd-gc] An activation transaction is unreadable or unjournaled; skipping GC.')
    return
  }
  await gcOldRemoteInstallVersions(
    options.conn,
    HELIXD_INSTALL_MODEL,
    options.remoteHome,
    options.currentDirAbsPath,
    options.host,
    {
      pinnedDirNames: [
        ...helixdGcPinnedDirNames(options.record, options.liveDaemonVersion),
        ...transaction.dirNames
      ],
      // Screen Windows candidates together, then recheck dead candidates individually under the GC claim.
      ...(isWindowsRemoteHost(options.host)
        ? { resolveExtraPinnedDirNames: (candidates) => windowsLiveCandidates(options, candidates) }
        : {}),
      isDirLive: async (dir) => {
        try {
          const probe = await execCommand(
            options.conn,
            helixdLivenessProbeCommand(options.host, dir),
            {
              wrapCommand: options.host.commandDialect !== 'powershell',
              signal: options.signal
            }
          )
          return helixdLivenessAnswerBlocksGc(probe)
        } catch (error) {
          if (isUnconfirmedSshCommandTermination(error)) {
            throw error
          }
          // Failed probes cannot prove the tree is idle.
          return true
        }
      }
    }
  )
  // Remove slots before runtimes so their references are released first.
  if (options.nodeRuntimePins?.length) {
    await gcRemoteNodeRuntimeStore(options.conn, options.host, options.remoteHome, {
      currentPins: options.nodeRuntimePins,
      signal: options.signal
    })
  }
}

/** Null means unknown host state and keeps every candidate; otherwise pin anything not proven dead. */
async function windowsLiveCandidates(
  options: HelixdGcOptions,
  candidates: readonly string[]
): Promise<readonly string[] | null> {
  const dirs = candidates.map((name) =>
    joinRemotePath(options.host, options.remoteHome, RELAY_REMOTE_DIR, name)
  )
  let output: string
  try {
    output = await execCommand(
      options.conn,
      helixdWindowsHomeOpCommand(options.host, options.remoteHome, 'liveness-many', dirs),
      { wrapCommand: false, signal: options.signal }
    )
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return null
  }
  const line = output
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(`${HELIXD_WINDOWS_LIVENESS_MANY_MARKER} `))
  const states = line?.slice(HELIXD_WINDOWS_LIVENESS_MANY_MARKER.length + 1).split(',') ?? []
  if (states.length !== candidates.length) {
    return null
  }
  return candidates.filter(
    (_name, index) => states[index] !== 'DEAD' && states[index] !== HELIXD_NEVER_LAUNCHED
  )
}
