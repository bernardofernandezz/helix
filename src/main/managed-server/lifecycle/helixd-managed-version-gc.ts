import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import type { ServeReadiness } from '../../server/serve-readiness'
import { readHelixdActivationRecord } from '../activation/helixd-activation-record-store'
import { helixdSlotDir, type HelixdSlotOptions } from '../../ssh/helixd-recovery-slot'
import { gcOldHelixdVersions } from '../install/helixd-remote-gc'
import { nodeRuntimeStorePins } from '../../ssh/pinned-runtime-host-target'

/** null proves no daemon; undefined means its version is unknown. */
export function provenLiveDaemonVersion(readiness: ServeReadiness): string | null | undefined {
  const daemon = readiness.health?.terminalDaemon
  if (daemon?.state === 'live' && daemon.buildVersion) {
    return daemon.buildVersion
  }
  return daemon?.state === 'absent' ? null : undefined
}

export async function pruneManagedHelixdVersions(args: {
  slot: HelixdSlotOptions
  serverTarget: NodeRuntimeTarget
  activeVersion: string
  readiness: ServeReadiness
}): Promise<void> {
  const liveDaemonVersion = provenLiveDaemonVersion(args.readiness)
  // Unknown daemon versions could still execute from any candidate tree; skip GC.
  if (liveDaemonVersion === undefined) {
    return
  }
  try {
    await gcOldHelixdVersions({
      conn: args.slot.conn,
      host: args.slot.host,
      remoteHome: args.slot.remoteHome,
      currentDirAbsPath: helixdSlotDir(args.slot, args.activeVersion),
      record: await readHelixdActivationRecord(args.slot),
      liveDaemonVersion,
      // Default and compat builds share one runtime store.
      nodeRuntimePins: nodeRuntimeStorePins(args.serverTarget),
      signal: args.slot.signal
    })
  } catch (error) {
    // Cleanup must not fail completed deploys; later connects retry.
    console.warn('[helixd-gc] Pruning old helixd versions failed:', error)
  }
}
