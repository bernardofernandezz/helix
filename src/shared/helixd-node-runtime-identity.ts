import { NODE_RUNTIME_PIN } from './node-runtime-pin'
import type { HelixdPreflightRuntimeIdentity } from './helixd-profile-preflight'

/** What a Node slot's candidate must report: the pinned runtime, never a host Node. */
export const HELIXD_NODE_RUNTIME_IDENTITY: HelixdPreflightRuntimeIdentity = {
  runtime: 'node',
  runtimeVersion: NODE_RUNTIME_PIN.version
}
