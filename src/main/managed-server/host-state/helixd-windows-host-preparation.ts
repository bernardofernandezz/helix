// Stage pinned Node and a content-addressed host script so Windows operations share verified bytes without replacing running clients' code.
import { join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-environment'
import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import { ensureRemoteHelixdNodeRuntime } from '../install/helixd-remote-node-runtime'
import {
  installHelixdWindowsHostScript,
  helixdRemoteBaseDir
} from '../install/helixd-remote-windows-node'
import { materializeNodeRuntimeArchive } from '../../node-runtime/pinned-runtime-materializer'
import type { HelixdHostTransport } from '../../ssh/helixd-host-transport'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

export async function prepareWindowsHelixdHost(options: {
  conn: HelixdHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  serverTarget: NodeRuntimeTarget
  signal?: AbortSignal
}): Promise<void> {
  const baseDir = helixdRemoteBaseDir(options.host, options.remoteHome)
  await ensureRemoteHelixdNodeRuntime({
    conn: options.conn,
    host: options.host,
    // The runtime store is a sibling of slots; only this synthetic slot's parent is used.
    slotDir: joinRemotePath(options.host, baseDir, 'helixd-host'),
    target: options.serverTarget,
    archivePath: () =>
      materializeNodeRuntimeArchive(
        options.serverTarget,
        join(getAppEnvironment().getPath('userData'), 'helixd-artifacts'),
        { signal: options.signal }
      ),
    signal: options.signal
  })
  await installHelixdWindowsHostScript(options, baseDir)
}
