export const BASH_PROMPT_COMMAND_COMPOSITION_BLOCK = `__helix_normalize_prompt_command_part() {
  local __helix_value="$1" __helix_output_name="$2" __helix_character __helix_chunk
  local __helix_value_length=\${#1} __helix_suffix_length=0 __helix_backslash_length=0
  local __helix_output_length __helix_scan_start
  while (( __helix_value_length - __helix_suffix_length >= 1024 )); do
    __helix_scan_start=$(( __helix_value_length - __helix_suffix_length - 1024 ))
    __helix_chunk="\${__helix_value:__helix_scan_start:1024}"
    case "$__helix_chunk" in
      *[!$' \\t\\n;']*) break ;;
      *) __helix_suffix_length=$(( __helix_suffix_length + 1024 )) ;;
    esac
  done
  while (( __helix_suffix_length < __helix_value_length )); do
    __helix_character="\${__helix_value: -__helix_suffix_length - 1:1}"
    case "$__helix_character" in
      ' '|$'\\t'|$'\\n'|';') __helix_suffix_length=$(( __helix_suffix_length + 1 )) ;;
      *) break ;;
    esac
  done
  __helix_output_length=$(( \${#__helix_value} - __helix_suffix_length ))
  while (( __helix_output_length - __helix_backslash_length >= 1024 )); do
    __helix_scan_start=$(( __helix_output_length - __helix_backslash_length - 1024 ))
    __helix_chunk="\${__helix_value:__helix_scan_start:1024}"
    case "$__helix_chunk" in
      *[!\\\\]*) break ;;
      *) __helix_backslash_length=$(( __helix_backslash_length + 1024 )) ;;
    esac
  done
  while (( __helix_backslash_length < __helix_output_length )); do
    __helix_character="\${__helix_value:__helix_output_length - __helix_backslash_length - 1:1}"
    [[ "$__helix_character" == '\\' ]] || break
    __helix_backslash_length=$(( __helix_backslash_length + 1 ))
  done
  # Preserve the first separator when an odd backslash run escapes it.
  if (( __helix_suffix_length > 0 && __helix_backslash_length % 2 == 1 )); then
    __helix_suffix_length=$(( __helix_suffix_length - 1 ))
    __helix_backslash_length=0
  fi
  __helix_output_length=$(( \${#__helix_value} - __helix_suffix_length ))
  __helix_value="\${__helix_value:0:__helix_output_length}"
  # Bash 4.4-5.0 scalar prompt evaluation preserves an odd terminal backslash.
  if (( __helix_suffix_length == 0 && ((BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] == 0)) && __helix_backslash_length % 2 == 1 )); then
    __helix_value="$__helix_value\\\\"
  fi
  printf -v "$__helix_output_name" '%s' "$__helix_value"
}
__helix_restore_prompt_status() {
  return "$1"
}
__helix_update_user_debug_trap() {
  local __helix_debug_trap_spec="$1" __helix_unchanged_debug_trap_spec="$2"
  local __helix_debug_trap_command
  [[ "$__helix_debug_trap_spec" != "$__helix_unchanged_debug_trap_spec" ]] || return 0
  [[ "$__helix_debug_trap_spec" != "trap -- '__helix_osc133_preexec' DEBUG" ]] || return 0
  if [[ -z "$__helix_debug_trap_spec" ]]; then
    __helix_user_debug_trap=""
    unset __helix_chained_debug_trap
    return 0
  fi
  __helix_debug_trap_command="\${__helix_debug_trap_spec#trap -- }"
  __helix_debug_trap_command="\${__helix_debug_trap_command% DEBUG}"
  eval "__helix_user_debug_trap=$__helix_debug_trap_command"
  unset __helix_chained_debug_trap
}
__helix_run_user_debug_trap() {
  if [[ -n "\${__helix_user_debug_trap:-}" ]]; then
    eval "$__helix_user_debug_trap" || true
  fi
}
__helix_adopt_outer_debug_trap() {
  local __helix_debug_trap_spec="\${__helix_outer_debug_trap_spec:-}"
  unset __helix_outer_debug_trap_spec
  __helix_update_user_debug_trap "$__helix_debug_trap_spec" "trap -- '__helix_osc133_preexec' DEBUG"
}
__helix_run_prompt_command_array() {
  local __helix_exit_code="\${__helix_prompt_status:-$?}" __helix_prompt_part __helix_prompt_index __helix_user_count
  local __helix_suffix_part
  local __helix_final_prompt_command
  local __helix_in_prompt_dispatch=1 __helix_dispatching_user_prompt_command=""
  unset __helix_prompt_status
  __helix_adopt_outer_debug_trap
  trap '__helix_osc133_preexec' DEBUG
  for __helix_prompt_part in "\${__helix_prompt_command_prefix[@]+"\${__helix_prompt_command_prefix[@]}"}"; do
    if (( __helix_exit_code == 0 )); then
      eval "$__helix_prompt_part"
    else
      __helix_restore_prompt_status "$__helix_exit_code" || eval "$__helix_prompt_part"
    fi
  done
  __helix_user_count=0
  for __helix_prompt_part in "\${__helix_prompt_command_array[@]+"\${__helix_prompt_command_array[@]}"}"; do
    __helix_user_count=$(( __helix_user_count + 1 ))
  done
  for (( __helix_prompt_index = 0; __helix_prompt_index + 1 < __helix_user_count; __helix_prompt_index++ )); do
    __helix_prompt_part="\${__helix_prompt_command_array[__helix_prompt_index]}"
    __helix_dispatching_user_prompt_command=1
    if (( __helix_exit_code == 0 )); then
      eval "$__helix_prompt_part"
    else
      __helix_restore_prompt_status "$__helix_exit_code" || eval "$__helix_prompt_part"
    fi
    __helix_dispatching_user_prompt_command=""
  done
  if (( __helix_user_count > 0 )); then
    __helix_prompt_part="\${__helix_prompt_command_array[__helix_user_count - 1]}"
    # Why: keep the final user hook and Helix suffixes in one status-preserving eval.
    __helix_final_prompt_command='eval "$__helix_prompt_part"'
    for __helix_suffix_part in "\${__helix_prompt_command_suffix[@]+"\${__helix_prompt_command_suffix[@]}"}"; do
      __helix_final_prompt_command+=$'\\n'"$__helix_suffix_part"
    done
    __helix_dispatching_user_prompt_command=1
    if (( __helix_exit_code == 0 )); then
      eval "$__helix_final_prompt_command"
    else
      __helix_restore_prompt_status "$__helix_exit_code" || eval "$__helix_final_prompt_command"
    fi
    __helix_dispatching_user_prompt_command=""
  else
    for __helix_prompt_part in "\${__helix_prompt_command_suffix[@]+"\${__helix_prompt_command_suffix[@]}"}"; do
      if (( __helix_exit_code == 0 )); then
        eval "$__helix_prompt_part"
      else
        __helix_restore_prompt_status "$__helix_exit_code" || eval "$__helix_prompt_part"
      fi
    done
  fi
  return "$__helix_exit_code"
}
__helix_finish_legacy_prompt_dispatch() {
  local __helix_suffix_part
  if [[ -n "\${__helix_in_prompt_command:-}" ]]; then
    for __helix_suffix_part in "\${__helix_prompt_command_suffix[@]+"\${__helix_prompt_command_suffix[@]}"}"; do
      eval "$__helix_suffix_part"
    done
  fi
}
__helix_normalize_prompt_command() {
  [[ -z "\${__helix_prompt_command_normalized:-}" ]] || return 0
  local __helix_prompt_part
  local -a __helix_normalized=()
  for __helix_prompt_part in "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}"; do
    __helix_normalize_prompt_command_part "$__helix_prompt_part" __helix_prompt_part
    [[ -n "$__helix_prompt_part" ]] && __helix_normalized+=("$__helix_prompt_part")
  done
  __helix_prompt_command_normalized=1
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND=("\${__helix_normalized[@]+"\${__helix_normalized[@]}"}")
  else
    __helix_prompt_command_array=("\${__helix_normalized[@]+"\${__helix_normalized[@]}"}")
    __helix_prompt_command_prefix=()
    __helix_prompt_command_suffix=()
    unset PROMPT_COMMAND
    # Why: PID scope distinguishes legacy prompt dispatch from ordinary user command text.
    __helix_prompt_status_variable="__helix_prompt_status_$$"
    __helix_prompt_status_capture_command="$__helix_prompt_status_variable=\\$?"
    __helix_prompt_status_value="\\\${$__helix_prompt_status_variable}"
    # Why: a changed DEBUG trap misses the capture command, and bash <= 4.3 reverts traps set in functions.
    PROMPT_COMMAND="$__helix_prompt_status_capture_command; __helix_in_legacy_prompt_wrapper=1; __helix_prompt_status=$__helix_prompt_status_value"'; __helix_prompt_had_functrace=""; if [[ -o functrace ]]; then __helix_prompt_had_functrace=1; set +T; fi; __helix_outer_debug_trap_spec="$(trap -p DEBUG)"; [[ -z "$__helix_prompt_had_functrace" ]] || set -T; unset __helix_prompt_had_functrace; __helix_run_prompt_command_array; __helix_finish_legacy_prompt_dispatch; trap __helix_osc133_preexec DEBUG; unset __helix_in_legacy_prompt_wrapper'
  fi
}
__helix_prepend_prompt_command() {
  local command="$1"
  __helix_normalize_prompt_command
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND=("$command" "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}")
  else
    __helix_prompt_command_prefix=("$command" "\${__helix_prompt_command_prefix[@]+"\${__helix_prompt_command_prefix[@]}"}")
  fi
}
__helix_append_prompt_command() {
  local command="$1"
  __helix_normalize_prompt_command
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND+=("$command")
  else
    __helix_prompt_command_suffix+=("$command")
  fi
}`
