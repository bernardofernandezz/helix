/** Injected session identity resolves the orchestration caller without guessing a terminal. Valid only on the same host/user: refuse claims across SSH, pairing or WSL, and omit it from SSH passthrough. */
import { HELIX_SESSION_ADDRESS_PREFIX } from './helix-session-address-prefix'
import { isStructuredWorkerHandle } from './structured-worker-handle'

export const HELIX_AGENT_SESSION_ID_ENV = 'HELIX_AGENT_SESSION_ID'

/** The reservation token distinguishes its live child from a process that reused the PID. */
export const HELIX_AGENT_SESSION_SPAWN_TOKEN_ENV = 'HELIX_AGENT_SESSION_SPAWN_TOKEN'

export function readInjectedAgentSessionId(
  env: Readonly<Record<string, string | undefined>> = process.env
): string | undefined {
  const value = env[HELIX_AGENT_SESSION_ID_ENV]?.trim()
  return value ? value : undefined
}

/** Match the resolved host mailbox address: workers retain their minted handle; other sessions use helix_session_id:<id>. The CLI cannot call the host resolver. */
export function injectedSessionAddress(
  env: Readonly<Record<string, string | undefined>> = process.env
): string | undefined {
  const sessionId = readInjectedAgentSessionId(env)
  if (!sessionId) {
    return undefined
  }
  const ownHandle = env.HELIX_TERMINAL_HANDLE
  return isStructuredWorkerHandle(ownHandle)
    ? ownHandle
    : `${HELIX_SESSION_ADDRESS_PREFIX}${sessionId}`
}
