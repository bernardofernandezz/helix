import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'
import { WORKTREE_LISTING_SCOPE_NOTES } from './worktree-listing-scope-notes'
import { WORKTREE_SET_COMMAND_SPEC } from './worktree-set'
import { SERVE_COMMAND_SPECS } from './serve'
import { REPO_COMMAND_SPECS } from './repo'
import { TERMINAL_SEND_COMMAND_SPEC } from './terminal-send'
import { TERMINAL_CLOSE_COMMAND_SPEC } from './terminal-close'
import { TERMINAL_SET_PANE_TITLE_COMMAND_SPEC } from './terminal-set-pane-title'

export const CORE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['open'],
    summary: 'Launch Helix and wait for the runtime to be reachable',
    usage: 'helix open [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['helix open', 'helix open --json']
  },
  ...SERVE_COMMAND_SPECS,
  {
    path: ['status'],
    summary: 'Show app/runtime/graph readiness',
    usage: 'helix status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      "caller.helixSessionId is this agent's Helix session ID, as Helix resolved it, when the agent runs as an Helix session; otherwise caller is omitted."
    ],
    examples: ['helix status', 'helix status --json']
  },
  {
    path: ['claude-teams'],
    argumentMode: 'passthrough',
    summary: 'Start Claude Code Agent Teams in the current Helix terminal',
    usage: 'helix claude-teams [claude args...]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Passes all following arguments through to Claude Code after enabling Agent Teams native panes.',
      'Must be run from inside an Helix terminal. Starts Claude Code Agent Teams in the current pane and opens teammates as native Helix splits.'
    ],
    examples: ['helix claude-teams', 'helix claude-teams --resume <session-id>']
  },
  ...REPO_COMMAND_SPECS,
  {
    path: ['worktree', 'list'],
    summary: 'List Helix-managed worktrees',
    usage: 'helix worktree list [--repo <selector>] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'limit'],
    notes: [...WORKTREE_LISTING_SCOPE_NOTES]
  },
  {
    path: ['worktree', 'show'],
    summary: 'Show one worktree',
    usage: 'helix worktree show --worktree <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['worktree', 'current'],
    summary: 'Show the Helix-managed worktree for the current directory',
    usage: 'helix worktree current [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Resolves the current shell directory to a path: selector so agents can target the enclosing Helix worktree without spelling out $PWD.'
    ],
    examples: ['helix worktree current', 'helix worktree current --json']
  },
  {
    path: ['worktree', 'create'],
    repeatableFlags: ['reference'],
    summary: 'Create a new Helix-managed worktree',
    usage:
      'helix worktree create --name <name> [--repo <selector>|--project <id-or-name> [--host <host>]|--project-host-setup <id>] [--agent <id>] [--prompt <text>] [--model <id>] [--effort <level>] [--surface chat|terminal] [--setup run|skip|inherit] [--base-branch <ref>] [--reference <url-or-jira-key>...] [--reference-site <id>] [--issue <number>] [--pr <number>] [--linear-issue <identifier-or-url>] [--gitlab-issue <number-or-url>] [--gitlab-mr <number-or-url>] [--comment <text>] [--parent-worktree <selector>] [--no-parent] [--run-hooks] [--activate] [--retry-launch <operationId>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'repo',
      'project',
      'host',
      'project-host-setup',
      'name',
      'agent',
      'prompt',
      'model',
      'effort',
      'surface',
      'retry-launch',
      'base-branch',
      'reference',
      'reference-site',
      'issue',
      'pr',
      'linear-issue',
      'gitlab-issue',
      'gitlab-mr',
      'comment',
      'setup',
      'parent-worktree',
      'no-parent',
      'run-hooks',
      'activate'
    ],
    notes: [
      'Repeat --reference to attach full issue or review URLs, or Jira issue keys, before setup or agent startup. Use --reference-site to choose the Jira site for keys. Other providers require full URLs. Cannot combine with legacy link flags.',
      'This creates a new checkout. For a fresh agent in an existing worktree, use `helix agent launch` instead.',
      'By default, Helix records the new worktree as a child of the caller context when it can infer one from the Helix terminal or current directory.',
      'If --repo is omitted, Helix infers the repo from the current Helix-managed worktree.',
      'Use --project to create on a ready project host setup without spelling the backing repo id. --project takes the project id or the display name from `helix project list`.',
      '--host is only needed when the project is set up on more than one host; with a single setup Helix uses it. When it is ambiguous the error names every host the project is set up on.',
      '--host takes local, ssh:<target-id>, runtime:<environment-id>, or the bare host name `helix host list` prints for any of them.',
      'For related work, use the inferred parent or pass --parent-worktree active, folder:<id>, or worktree:<worktreeId> to make the relationship explicit. Worktree ids are the full <repo-id>::<path> values returned by `helix worktree list --json`.',
      'Use --no-parent when the new worktree should be independent of the current context.',
      '--no-parent only affects Helix lineage; omit --base-branch to use the repo default base, or pass the default base ref explicitly for independent top-level work.',
      'By default this creates the worktree and its first terminal without switching the active Helix view.',
      'Pass --agent to start an agent with the worktree, as a chat or a terminal per your Chat UI setting, exactly as a new agent tab does; --prompt sends initial work to it. --model and --effort pick its model and reasoning effort, and --surface chat|terminal picks chat or terminal for this launch instead of your setting.',
      'After a lost agent launch reply, re-issue the same command from the same directory on the same host with --retry-launch <operationId> from the error. Never retry as a fresh launch; older hosts require inspecting the workspace first.',
      'With --agent --json, result.launch says what started: launch.outcome.kind (structured chat or terminal), launch.outcome.handle, and launch.receipt.detail for why. An Helix host older than this returns the terminal agent handle in result.agentTerminalHandle instead.',
      'Repo-defined setup hooks follow the repository setup policy; pass --setup run to force them.',
      'Pass --activate when the CLI caller intentionally wants to reveal the new worktree in the app.',
      'Passing --run-hooks is kept as a legacy alias for --setup run and reveals the worktree.',
      'Use --pr for GitHub pull requests; --gitlab-issue and --gitlab-mr write separate GitLab links. GitLab URLs must match the stored source project or remote; they cannot select a foreign project.'
    ],
    examples: [
      'helix worktree create --name agent-task --agent codex --prompt "hi" --json',
      'helix worktree create --name design --no-parent --agent codex --model gpt-6-astra --effort high --prompt "Write the design doc" --json',
      'helix worktree create --repo id:<repoId> --name related-task --json',
      'helix worktree create --project github:bernardofernandezz/helix --host runtime:03ef704c-b180-4b10-998d-e28fbd5de9a3 --name benchmark --json',
      'helix worktree create --repo id:<repoId> --name linear-task --linear-issue https://linear.app/bernardofernandezz/issue/BIO-335/test-issue --json',
      'helix worktree create --repo id:<repoId> --name agent-task --agent codex --prompt "hi" --json',
      'helix worktree create --repo id:<repoId> --name folder-child --parent-worktree folder:<folderId> --json',
      'helix worktree create --repo id:<repoId> --name related-task --parent-worktree active --json',
      'helix worktree create --repo id:<repoId> --name independent-task --no-parent --json'
    ]
  },
  WORKTREE_SET_COMMAND_SPEC,
  {
    path: ['worktree', 'rm'],
    aliases: [
      ['worktree', 'remove'],
      ['worktree', 'delete']
    ],
    destructive: true,
    summary: 'Remove a worktree from Helix and git',
    usage:
      'helix worktree rm --worktree <selector> [--force] [--run-hooks] [--allow-failed-archive-hook] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'force', 'run-hooks', 'allow-failed-archive-hook'],
    notes: [
      'Repo-defined helix.yaml archive hooks are skipped unless --run-hooks is passed.',
      'With --run-hooks, a failed archive hook blocks the removal: nothing is stopped, deleted or deregistered, and the command exits non-zero with error code worktree_archive_hook_failed. --force does not waive this.',
      'Pass --allow-failed-archive-hook to delete anyway after the hook has run and failed; the waived failure is reported back on result.archiveHookOverride. It requires --run-hooks and is rejected without it, because with no hook running there is no failure to waive.',
      'For Git worktrees, removal also attempts to delete the checked-out local branch, with or without --force. Helix retains branches it knows predated the worktree and any branch whose changes it cannot prove are already merged.'
    ]
  },
  {
    path: ['worktree', 'ps'],
    summary: 'Show a compact orchestration summary across worktrees',
    usage: 'helix worktree ps [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'limit'],
    notes: [...WORKTREE_LISTING_SCOPE_NOTES]
  },
  {
    path: ['terminal', 'list'],
    summary: 'List live Helix-managed terminals',
    usage:
      'helix terminal list [--worktree <selector>] [--limit <n>] [--include-visual-layouts] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'limit', 'include-visual-layouts'],
    notes: [
      'JSON omits visualLayouts by default; pass --include-visual-layouts when machine-readable tab and pane topology is required.'
    ]
  },
  {
    path: ['terminal', 'show'],
    summary: 'Show terminal metadata and preview',
    usage: 'helix terminal show [--terminal <handle>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal']
  },
  {
    path: ['terminal', 'read'],
    summary: 'Read bounded terminal output',
    usage:
      'helix terminal read [--terminal <handle>] [--cursor <n>] [--limit <n>] [--screen] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal', 'cursor', 'limit', 'screen'],
    notes: [
      'Omit --terminal to target the active terminal in the current worktree.',
      'By default this returns accumulated terminal output with escape sequences stripped, not the rendered screen. Any program that repaints a line — shells, progress bars, TUIs — comes back as stacked fragments, so one `clear` keystroke by keystroke reads as `cclclecleaclear`, and spaces a prompt draws by moving the cursor are absent.',
      'Use --screen to read what the terminal actually renders. Prefer it whenever the answer depends on how output looks rather than what was emitted over time; the default is unsuitable for verifying rendered output.',
      'The result reports source: stream when it is accumulated output, screen when it is the rendered screen, and screen-unavailable when a screen was asked for but none could be rendered and the accumulated output is being returned instead. An absent source means the host predates the field.',
      'When present, draft is UI-only composer text excluded from tail; never treat it as terminal output or a submitted instruction.',
      '--screen and --cursor are mutually exclusive: a screen read is the current frame and has no history to page.',
      'Use --cursor with the nextCursor value from a previous read to get only new output since that read.',
      'Use --limit to request more retained lines for long agent responses; output reports oldestCursor when older lines were dropped.',
      'Useful for capturing the response to a command: read before sending, then read --cursor <prev> after waiting.'
    ],
    examples: [
      'helix terminal read --json',
      'helix terminal read --terminal term_abc123 --cursor 42 --limit 1000 --json',
      'helix terminal read --terminal term_abc123 --screen --json'
    ]
  },
  TERMINAL_SEND_COMMAND_SPEC,
  {
    path: ['terminal', 'wait'],
    summary: 'Wait for a terminal condition',
    usage:
      'helix terminal wait [--terminal <handle>] --for exit|tui-idle [--timeout-ms <ms>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal', 'for', 'timeout-ms']
  },
  {
    path: ['terminal', 'stop'],
    hidden: true,
    summary: 'Deprecated compatibility command for stopping terminal processes',
    usage: 'helix terminal stop --worktree <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: [
      'Deprecated: use terminal close --worktree <selector> --all to stop the processes and durably remove their terminal surfaces.'
    ]
  },
  {
    path: ['terminal', 'create'],
    summary: 'Create a terminal session in the current worktree',
    usage:
      'helix terminal create [--worktree <selector>] [--title <name>] [--command <text>] [--shell <shell>] [--focus] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'command', 'shell', 'title', 'focus'],
    notes: [
      'Creates a visible terminal tab without switching focus when possible; falls back to a background handle if the UI cannot adopt it. Pass --focus to switch to it.',
      'This creates a terminal and runs --command in it. To start an agent, use `helix agent launch` (or `helix worktree create --agent` for a new checkout), which follows your Chat UI setting.',
      '--shell picks the shell the terminal IS on a Windows host (cmd.exe, powershell.exe, pwsh.exe, wsl.exe, bash.exe, git-bash); --command is typed into whatever shell the host started, so `--command cmd.exe` leaves a cmd running INSIDE the default shell and exiting it drops back to that shell.',
      'A host that cannot apply --shell refuses the create rather than quietly spawning its default shell: macOS and Linux execution hosts spawn the login shell, terminals routed over SSH resolve their shell on the SSH host, a --shell that contradicts the project execution runtime (WSL vs Windows host) is refused, and an Helix host older than --shell is refused by the CLI.'
    ],
    examples: [
      'helix terminal create --json',
      'helix terminal create --worktree active --command "pnpm dev" --json',
      'helix terminal create --worktree path:/projects/myapp --title "RUNNER" --command "npm test"',
      'helix terminal create --worktree path:/projects/myapp --command "pnpm dev" --focus',
      'helix terminal create --worktree path:C:/src/app --shell cmd.exe --json'
    ]
  },
  {
    path: ['terminal', 'switch'],
    // Preserve the legacy focus verb.
    aliases: [['terminal', 'focus']],
    summary: 'Switch to a terminal tab in the UI',
    usage: 'helix terminal switch [--terminal <handle>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal'],
    notes: [
      "With --environment, the desktop app on this machine switches to that server's terminal; a server has no window of its own."
    ],
    examples: ['helix terminal switch --terminal term_abc123']
  },
  TERMINAL_CLOSE_COMMAND_SPEC,
  {
    path: ['terminal', 'rename'],
    summary: 'Set or clear the title of a terminal tab',
    usage: 'helix terminal rename [--terminal <handle>] [--title <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal', 'title'],
    notes: ['Omit --title or pass an empty string to reset to the auto-generated title.'],
    examples: [
      'helix terminal rename --terminal term_abc123 --title "RUNNER"',
      'helix terminal rename --terminal term_abc123 --json'
    ]
  },
  TERMINAL_SET_PANE_TITLE_COMMAND_SPEC,
  {
    path: ['terminal', 'split'],
    summary: 'Split an existing terminal pane',
    usage:
      'helix terminal split [--terminal <handle>] [--direction horizontal|vertical] [--command <text>] [--retry-split <leafId>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal', 'direction', 'command', 'retry-split'],
    notes: [
      'A timeout does not mean the split failed: the pane may still open and run --command. Re-run the same command with --retry-split <leafId> from the error to wait for that pane instead of splitting again.'
    ],
    examples: [
      'helix terminal split --terminal term_abc123 --direction horizontal --json',
      'helix terminal split --terminal term_abc123 --command "codex"'
    ]
  }
]
