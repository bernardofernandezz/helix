import { HELIX_AGENT_SESSION_ID_ENV } from '../../../../shared/agent-session-caller-env'
import { HELIX_STRUCTURED_SESSION_ENV } from '../../../../shared/structured-session-marker'

export const AGENT_HOOK_RUNTIME_ENV_KEYS = [
  'HELIX_AGENT_HOOK_PORT',
  'HELIX_AGENT_HOOK_TOKEN',
  'HELIX_AGENT_HOOK_ENV',
  'HELIX_AGENT_HOOK_VERSION',
  'HELIX_AGENT_HOOK_TRANSPORT',
  'HELIX_AGENT_HOOK_ENDPOINT',
  // Remove the reverted inherited path still present in older PTYs.
  'HELIX_CLAUDE_AGENT_STATUS_SETTINGS'
] as const

// Inherited Claude child stamps make an independent pane act as the launching session's child.
export const CLAUDE_CHILD_SESSION_STAMP_ENV_KEYS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_ENTRYPOINT'
] as const

// Inherited structured-session IDs would make every pane claim the parent orchestration caller.
export const HELIX_AGENT_SESSION_CALLER_ENV_KEYS = [
  HELIX_AGENT_SESSION_ID_ENV,
  HELIX_STRUCTURED_SESSION_ENV
] as const
