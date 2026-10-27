// The host records quit/update/crash on the cut-turn row for Continue. Unknown wire causes retain the row's words without a named cause.

export const AGENT_SESSION_HELIX_STOP_CAUSES = ['update', 'quit', 'crash'] as const
/** The row's presentation, so a client that re-words host rows it can't name passes it through. */
export const AGENT_SESSION_HELIX_STOP_PRESENTATION = 'helix-stop'
export type AgentSessionHelixStopCause = (typeof AGENT_SESSION_HELIX_STOP_CAUSES)[number]
export type AgentSessionHelixStop = { cause: AgentSessionHelixStopCause }

export function isAgentSessionHelixStopCause(value: unknown): value is AgentSessionHelixStopCause {
  return AGENT_SESSION_HELIX_STOP_CAUSES.some((cause) => cause === value)
}

/** The stop a row states, when this build knows its cause. */
export function readAgentSessionHelixStop(value: unknown): AgentSessionHelixStop | undefined {
  const cause =
    typeof value === 'object' && value !== null && 'cause' in value ? value.cause : undefined
  return isAgentSessionHelixStopCause(cause) ? { cause } : undefined
}
