import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import { resolveHelixdDeploymentTargetFacts } from '../../ssh/helixd-deployment-target'
import { HelixdHostUnsupportedError } from '../../helixd/helixd-host-unavailable'
import type { HelixdHostTransport } from '../../ssh/helixd-host-transport'
import { pinnedRuntimeTargetForHost } from '../../ssh/pinned-runtime-host-target'
import type { RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

export async function resolveHelixdRuntimeTarget(options: {
  conn: HelixdHostTransport
  host: RemoteHostPlatform
  signal?: AbortSignal
  exec?: (command: string) => Promise<string>
}): Promise<NodeRuntimeTarget> {
  const facts = await resolveHelixdDeploymentTargetFacts(options)
  const target = pinnedRuntimeTargetForHost(facts)
  if (!target) {
    const glibc = facts.glibc ? `${facts.glibc.major}.${facts.glibc.minor}` : 'unknown'
    throw new HelixdHostUnsupportedError(
      `No Helix runtime supports ${facts.target} with glibc ${glibc}.`
    )
  }
  return target
}
