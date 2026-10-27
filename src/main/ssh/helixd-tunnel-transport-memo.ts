export type HelixdTunnelTransport = 'tcp_forward' | 'stdio_bridge'

const transports = new Map<string, HelixdTunnelTransport>()

export function rememberHelixdTunnelTransport(
  targetId: string,
  transport: HelixdTunnelTransport
): void {
  transports.set(targetId, transport)
}

export function knownHelixdTunnelTransport(targetId: string): HelixdTunnelTransport | null {
  return transports.get(targetId) ?? null
}
