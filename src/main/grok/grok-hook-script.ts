import { posixCurlCommand } from '../agent-hooks/hook-post-command'
import { getSharedManagedScriptPath, wrapPosixHookCommand } from '../agent-hooks/installer-utils'
import { wrapWindowsBatchHookCommand } from '../agent-hooks/windows-direct-cmd-hook-command'
import {
  buildPosixHookPayloadCapture,
  buildPosixHookSpoolLines,
  POSIX_HOOK_JSON_STDIN
} from '../agent-hooks/hook-stdin-contract'
import {
  buildWindowsGrokHookScript,
  GROK_HOME_ENVELOPE_MAX_LENGTH
} from './windows-grok-hook-script'

export function getGrokManagedScriptFileName(): string {
  return process.platform === 'win32' ? 'grok-hook.cmd' : 'grok-hook.sh'
}

export function getGrokManagedScriptPath(): string {
  return getSharedManagedScriptPath(getGrokManagedScriptFileName())
}

export function getGrokManagedCommand(scriptPath: string): string {
  // POSIX can gate before spawning because Helix injects HELIX_PANE_KEY only into panes it owns.
  return process.platform === 'win32'
    ? wrapWindowsBatchHookCommand(scriptPath)
    : wrapPosixHookCommand(scriptPath, {}, { requiredEnvVar: 'HELIX_PANE_KEY' })
}

export function getGrokManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return buildWindowsGrokHookScript()
  }

  return [
    '#!/bin/sh',
    ...buildPosixHookPayloadCapture('exit', POSIX_HOOK_JSON_STDIN),
    ...buildPosixHookSpoolLines('grok'),
    'if [ -n "$HELIX_AGENT_HOOK_ENDPOINT" ] && [ -r "$HELIX_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$HELIX_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$HELIX_AGENT_HOOK_PORT" ] || [ -z "$HELIX_AGENT_HOOK_TOKEN" ] || [ -z "$HELIX_PANE_KEY" ]; then',
    '  spool_hook_event',
    '  exit 0',
    'fi',
    'grok_home=',
    `if [ -n "\${GROK_HOME:-}" ] && [ "\${#GROK_HOME}" -le ${GROK_HOME_ENVELOPE_MAX_LENGTH} ]; then`,
    '  grok_home=$GROK_HOME',
    'fi',
    `printf '%s' "$payload" | ${posixCurlCommand()} -sS -X POST "http://127.0.0.1:\${HELIX_AGENT_HOOK_PORT}/hook/grok" \\`,
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Helix-Agent-Hook-Token: ${HELIX_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${HELIX_PANE_KEY}" \\',
    '  --data-urlencode "tabId=${HELIX_TAB_ID}" \\',
    '  --data-urlencode "launchToken=${HELIX_AGENT_LAUNCH_TOKEN}" \\',
    '  --data-urlencode "worktreeId=${HELIX_WORKTREE_ID}" \\',
    '  --data-urlencode "env=${HELIX_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${HELIX_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "grokHome=${grok_home}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || spool_hook_event',
    'exit 0',
    ''
  ].join('\n')
}
