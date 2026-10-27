/** Capture before Helix inserts its managed-script shell. */
export const CLAUDE_HOOK_PARENT_CAPTURE =
  'HELIX_HOOK_AGENT_PID="${PPID:-}"; export HELIX_HOOK_AGENT_PID; '

export function buildHookProcessCapture(): string[] {
  return [
    'helix_agent_process=',
    '[ -z "${HELIX_PANE_KEY:-}" ] || case "${HELIX_HOOK_AGENT_PID:-}" in ""|*[!0-9]*) ;; *)',
    '  if [ -r "/proc/$HELIX_HOOK_AGENT_PID/stat" ]; then',
    '    helix_agent_stat=$(cat "/proc/$HELIX_HOOK_AGENT_PID/stat" 2>/dev/null) || helix_agent_stat=',
    '    helix_agent_boot=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null) || helix_agent_boot=',
    '    helix_agent_fields=${helix_agent_stat##*) }',
    '    helix_agent_start=$(printf "%s" "$helix_agent_fields" | awk \'{print $20}\')',
    '    case "$helix_agent_start" in ""|*[!0-9]*) ;; *)',
    '      [ -z "$helix_agent_boot" ] || helix_agent_process=$(printf \'{"pid":%s,"platform":"linux","startTime":"%s:%s"}\' "$HELIX_HOOK_AGENT_PID" "$helix_agent_boot" "$helix_agent_start") ;; esac',
    '  elif [ "$(uname -s 2>/dev/null)" = Darwin ]; then',
    // Match the host probe's timezone when comparing local-time lstart strings.
    '    helix_agent_start=$(TZ=UTC0 LC_ALL=C /bin/ps -p "$HELIX_HOOK_AGENT_PID" -o lstart= 2>/dev/null | sed \'s/^ *//;s/ *$//\')',
    '    [ -z "$helix_agent_start" ] || helix_agent_process=$(printf \'{"pid":%s,"platform":"darwin","startTime":"%s"}\' "$HELIX_HOOK_AGENT_PID" "$helix_agent_start")',
    '  fi ;;',
    'esac'
  ]
}
