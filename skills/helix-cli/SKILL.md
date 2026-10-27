---
name: helix-cli
description: >-
  Operate Helix-managed worktrees, folder contexts, terminals, repos, automations, artifacts,
  skill sharing, worktree comments, and Helix's embedded browser through the `helix` CLI. Use
  when the user says "$helix-cli", "Helix worktree", "child worktree", "spawn codex/claude in a
  worktree", "read/wait/send Helix terminal", "handoff" / "handover" / "give this to another
  agent", "Helix browser", "helix artifacts", or "share skills". Prefer it over raw git
  worktree, ad hoc PTYs, or Computer Use when Helix state is involved. Use Computer Use only
  when a visible window needs GUI control that a CLI, filesystem, or API cannot do.
---

# Helix CLI

This discovery stub loads the version-matched guide from the Helix executable used for this session.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `HELIX_CLI_COMMAND` environment variable is set, use its value. Helix exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `HELIX_DEV_REPO_ROOT`, use `helix-dev`.
- Otherwise, on Linux outside an Helix-managed terminal, use `helix-ide`. Never run bare
  `helix` there — outside Helix's terminals it normally resolves to the
  GNOME Helix screen reader (`/usr/bin/helix`) and starts speech on the user's machine.
- Otherwise, use `helix`.

Below, `HELIX` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `HELIX` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different Helix build.

## Load the version-matched guide before running Helix commands

```text
HELIX skills get helix-cli
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Helix is not running, start it with `HELIX open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `HELIX open` or restart Helix. If
`skills get` is unknown, explain that updating Helix restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
