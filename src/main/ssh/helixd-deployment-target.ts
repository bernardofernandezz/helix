import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isNodeRuntimeTarget,
  type NodeRuntimeTarget,
  type ServerTarget
} from '../../shared/node-runtime-pin'
import { HELIXD_SERVER_TARGET_FILENAME } from '../../shared/helixd-artifacts'
import type { RemoteInstallTransport } from '../managed-server/install/remote-install-transport'
import { probeLinuxLibc, type GlibcVersion } from '../node-runtime/linux-libc-probe'
import { execCommand } from './remote-exec/remote-exec-command'
import type { RemoteHostPlatform } from './ssh-remote-platform'

type HelixdDeploymentTargetFacts = {
  target: ServerTarget
  /** The host's glibc, when the libc probe printed one; null on musl and non-Linux hosts. */
  glibc: GlibcVersion | null
}

export async function resolveHelixdDeploymentTargetFacts(options: {
  conn: RemoteInstallTransport
  host: RemoteHostPlatform
  signal?: AbortSignal
  exec?: (command: string) => Promise<string>
}): Promise<HelixdDeploymentTargetFacts> {
  const { host } = options
  if (host.os !== 'linux') {
    return { target: `${host.os}-${host.arch}`, glibc: null }
  }
  const exec =
    options.exec ??
    ((command: string) => execCommand(options.conn, command, { signal: options.signal }))
  const { libc, glibc } = await probeLinuxLibc(exec)
  return {
    target: `linux-${host.arch}-${libc}`,
    glibc
  }
}

/** Read the assembled bundle's recorded runtime target, including compatibility builds. */
export function readHelixdBundleTarget(localHelixdDir: string): NodeRuntimeTarget {
  const recorded = readFileSync(join(localHelixdDir, HELIXD_SERVER_TARGET_FILENAME), 'utf8').trim()
  if (!isNodeRuntimeTarget(recorded)) {
    throw new Error(`The helixd bundle names no known server target: ${recorded}`)
  }
  return recorded
}
