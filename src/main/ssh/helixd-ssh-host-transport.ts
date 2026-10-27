import type { HelixdHostTransport } from './helixd-host-transport'
import type { SshConnection } from './connection/ssh-connection'

/** Return the connection object itself: tunnel ownership, dedupe and caches depend on its identity. */
export function sshHelixdHostTransport(connection: SshConnection): HelixdHostTransport {
  return connection
}
