import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const PORTS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['ports'],
    summary: 'List the listening ports Helix detected for a workspace',
    usage: 'helix ports [--worktree <selector>] [--all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'all'],
    notes: [
      'Defaults to the Helix workspace that contains the current directory.',
      'Scans the host the workspace runs on and lists the ports Helix tied to it, by process working directory (match=cwd) or command line (match=command).',
      '--all lists every listener found on that host, including other workspaces and processes Helix could not tie to one. A native folder workspace needs --all, because Helix does not tie ports to folders.',
      'url is the address the dev server printed in an Helix terminal; it is missing when Helix did not see one.'
    ],
    examples: [
      'helix ports',
      'helix ports --worktree branch:feature/login --json',
      'helix ports --all',
      "helix ports --json | jq -r '.result.ports[0].advertisedUrl'"
    ]
  }
]
