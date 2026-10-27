import { basename, win32 as pathWin32 } from 'node:path'

export const POSIX_SHELL_STARTUP_COMMAND_ENV = 'HELIX_POSIX_SHELL_STARTUP_COMMAND'

export function supportsPosixShellStartupCommand(shellPath: string): boolean {
  const shellName = pathWin32.basename(basename(shellPath)).toLowerCase()
  return shellName === 'bash' || shellName === 'zsh' || shellName === 'fish'
}

export function getBashStartupCommandPromptBlock(): string {
  return `if [[ \${${POSIX_SHELL_STARTUP_COMMAND_ENV}+present} == present ]]; then
  __helix_remove_startup_command_prompt_hook() {
    local __helix_item
    local -a __helix_remaining=()
    if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
      for __helix_item in "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}"; do
        [[ "$__helix_item" == "__helix_run_startup_command" ]] || __helix_remaining+=("$__helix_item")
      done
      PROMPT_COMMAND=("\${__helix_remaining[@]+"\${__helix_remaining[@]}"}")
    else
      for __helix_item in "\${__helix_prompt_command_suffix[@]+"\${__helix_prompt_command_suffix[@]}"}"; do
        [[ "$__helix_item" == "__helix_run_startup_command" ]] || __helix_remaining+=("$__helix_item")
      done
      __helix_prompt_command_suffix=("\${__helix_remaining[@]+"\${__helix_remaining[@]}"}")
    fi
  }
  __helix_run_startup_command() {
    local __helix_command="$${POSIX_SHELL_STARTUP_COMMAND_ENV}" __helix_status
    unset ${POSIX_SHELL_STARTUP_COMMAND_ENV}
    __helix_remove_startup_command_prompt_hook
    unset -f __helix_remove_startup_command_prompt_hook
    builtin history -s "$__helix_command" 2>/dev/null || true
    builtin printf '%s\n' "$__helix_command"
    eval "$__helix_command"
    __helix_status=$?
    unset -f __helix_run_startup_command
    return "$__helix_status"
  }
  __helix_append_prompt_command "__helix_run_startup_command"
fi`
}
