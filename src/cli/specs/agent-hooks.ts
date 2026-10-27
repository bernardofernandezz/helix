import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AGENT_HOOK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'hooks', 'prepare-codex'],
    summary: "Prepare a WSL pane's Helix-managed Codex home before a shell launch",
    usage: 'helix agent hooks prepare-codex',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['agent', 'hooks', 'status'],
    summary: 'Show whether Helix-managed agent status hooks are enabled',
    usage: 'helix agent hooks status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['helix agent hooks status', 'helix agent hooks status --json']
  },
  {
    path: ['agent', 'hooks', 'off'],
    summary: 'Disable Helix-managed agent status hooks and remove local hook entries',
    usage: 'helix agent hooks off [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['helix agent hooks off']
  },
  {
    path: ['agent', 'hooks', 'on'],
    summary: 'Enable Helix-managed agent status hooks',
    usage: 'helix agent hooks on [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['helix agent hooks on']
  }
]
