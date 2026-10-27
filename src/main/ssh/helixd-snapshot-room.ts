/** Check snapshot room before stopping a serving incumbent. */
import { helixdRemoteBaseDir } from '../managed-server/install/helixd-remote-windows-node'
import { execHelixdRemoteOr } from '../managed-server/install/helixd-remote-runtime-control'
import {
  HELIXD_STATE_SNAPSHOT_DIR,
  type HelixdActivationRecord
} from '../managed-server/activation/helixd-activation-record'
import {
  helixdSnapshotShortfallKb,
  helixdSnapshotShortfallMessage,
  helixdSnapshotSpaceCommand,
  parseHelixdSnapshotSpace
} from '../managed-server/host-state/helixd-state-snapshot-space'
import { joinRemotePath } from './ssh-remote-platform'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'
import type { HelixdSlotOptions } from './helixd-recovery-slot'

export const HELIXD_SNAPSHOT_SPACE_INSUFFICIENT_CODE = 'helixd_snapshot_space_insufficient'

export function helixdSnapshotsRoot(
  options: Pick<HelixdSlotOptions, 'host' | 'remoteHome'>
): string {
  return joinRemotePath(
    options.host,
    helixdRemoteBaseDir(options.host, options.remoteHome),
    HELIXD_STATE_SNAPSHOT_DIR
  )
}

/** Unknown room proceeds to authoritative capture; return a refusal only for proven insufficient space. */
export async function helixdSnapshotRoomRefusal(
  options: HelixdSlotOptions,
  record: HelixdActivationRecord,
  fullVersion: string
): Promise<string | null> {
  const baseDir = helixdRemoteBaseDir(options.host, options.remoteHome)
  const command = helixdSnapshotSpaceCommand(
    options.host,
    options.userDataDir,
    helixdSnapshotsRoot(options),
    baseDir,
    record.snapshot ? [record.snapshot.dirName] : []
  )
  if (!command) {
    return null
  }
  const space = parseHelixdSnapshotSpace(await measureRoom(options, command))
  const shortfall = helixdSnapshotShortfallKb(space)
  return space && shortfall !== null
    ? helixdSnapshotShortfallMessage(space, shortfall, {
        userDataDir: options.userDataDir,
        baseDir,
        fullVersion,
        active: record.active
      })
    : null
}

async function measureRoom(options: HelixdSlotOptions, command: string): Promise<string> {
  try {
    return await execHelixdRemoteOr(options, command)
  } catch (error) {
    // Unconfirmed read-only cleanup leaves room unknown; capture decides, unless caller cancelled.
    if (isUnconfirmedSshCommandTermination(error) && !options.signal?.aborted) {
      return ''
    }
    throw error
  }
}
