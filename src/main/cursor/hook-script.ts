import {
  buildWindowsAgentHookPostCommand,
  wrapPosixHookCommand,
  buildWindowsHookPowerShellCommand,
  wrapWindowsPowerShellEncodedCommand
} from '../agent-hooks/installer-utils'
import { posixCurlCommand } from '../agent-hooks/hook-post-command'
import {
  buildPosixHookPayloadCapture,
  buildPosixHookSpoolLines,
  buildWindowsHookEnvironmentGuardLines
} from '../agent-hooks/hook-stdin-contract'
import {
  buildPosixGrokReplayGuardLines,
  buildWindowsGrokReplayGuardLines
} from '../agent-hooks/grok-replay-guard'
import { quoteStartupArg } from '../../shared/tui-agent-startup-shell'
import { getCursorHookResponse, type CursorEvent } from './hook-events'

const CURSOR_HOOK_RESPONSE_ENV = 'HELIX_CURSOR_HOOK_RESPONSE'

export function getPosixManagedCommand(scriptPath: string, eventName: CursorEvent): string {
  const response = getCursorHookResponse(eventName)
  return wrapPosixHookCommand(
    scriptPath,
    { [CURSOR_HOOK_RESPONSE_ENV]: response },
    { fallbackStdout: response }
  )
}

export function getManagedCommand(scriptPath: string, eventName: CursorEvent): string {
  if (process.platform !== 'win32') {
    // Cursor uses the login shell; wrap the POSIX guard in sh with portable quoting.
    return `/bin/sh -c ${quoteStartupArg(getPosixManagedCommand(scriptPath, eventName), 'posix')}`
  }
  const response = getCursorHookResponse(eventName)
  const command = buildWindowsHookPowerShellCommand(
    scriptPath,
    { [CURSOR_HOOK_RESPONSE_ENV]: response },
    { fallbackStdout: response }
  )
  // PowerShell 5.1 defaults to the ANSI code page when translating hook stdin.
  return wrapWindowsPowerShellEncodedCommand(
    `[Console]::InputEncoding = New-Object System.Text.UTF8Encoding; $OutputEncoding = [Console]::InputEncoding; ${command}`
  )
}

export function getManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return [
      '@echo off',
      'setlocal',
      // Cursor permission hooks reject empty or invalid stdout.
      `if defined ${CURSOR_HOOK_RESPONSE_ENV} (echo %${CURSOR_HOOK_RESPONSE_ENV}%) else (echo {})`,
      // Refresh endpoints for PTYs that survived an Helix restart.
      'if defined HELIX_AGENT_HOOK_ENDPOINT if exist "%HELIX_AGENT_HOOK_ENDPOINT%" call "%HELIX_AGENT_HOOK_ENDPOINT%" 2>nul',
      ...buildWindowsHookEnvironmentGuardLines(),
      ...buildWindowsGrokReplayGuardLines(),
      buildWindowsAgentHookPostCommand('cursor'),
      'exit /b 0',
      ''
    ].join('\r\n')
  }

  return [
    '#!/bin/sh',
    // Cursor permission hooks reject empty or invalid stdout.
    `if [ -n "$${CURSOR_HOOK_RESPONSE_ENV}" ]; then`,
    `  printf '%s\\n' "$${CURSOR_HOOK_RESPONSE_ENV}"`,
    'else',
    '  printf "{}\\n"',
    'fi',
    ...buildPosixHookPayloadCapture(),
    ...buildPosixGrokReplayGuardLines(),
    ...buildPosixHookSpoolLines('cursor'),
    // Refresh endpoints for PTYs that survived an Helix restart.
    'if [ -n "$HELIX_AGENT_HOOK_ENDPOINT" ] && [ -r "$HELIX_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$HELIX_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$HELIX_AGENT_HOOK_PORT" ] || [ -z "$HELIX_AGENT_HOOK_TOKEN" ] || [ -z "$HELIX_PANE_KEY" ]; then',
    '  spool_hook_event',
    '  exit 0',
    'fi',
    // Form encoding handles path-bearing IDs; stdin keeps large payloads off the command line.
    `printf '%s' "$payload" | ${posixCurlCommand()} -sS -X POST "http://127.0.0.1:\${HELIX_AGENT_HOOK_PORT}/hook/cursor" \\`,
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Helix-Agent-Hook-Token: ${HELIX_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${HELIX_PANE_KEY}" \\',
    '  --data-urlencode "tabId=${HELIX_TAB_ID}" \\',
    '  --data-urlencode "launchToken=${HELIX_AGENT_LAUNCH_TOKEN}" \\',
    '  --data-urlencode "worktreeId=${HELIX_WORKTREE_ID}" \\',
    '  --data-urlencode "env=${HELIX_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${HELIX_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || spool_hook_event',
    'exit 0',
    ''
  ].join('\n')
}
