// Stock zshrc can replace line-init after user config clears the prompt-hook array.
export const ZSH_DEFERRED_LINE_INIT_BLOCK = `__helix_deferred_line_init() {
  builtin emulate -L zsh
  (( \${+functions[__helix_deferred_init]} )) || return 0
  local __helix_direct_line_init=0
  [[ "\${widgets[zle-line-init]:-}" == user:__helix_deferred_line_init ]] && __helix_direct_line_init=1
  __helix_deferred_init
  if (( __helix_direct_line_init && \${+widgets[zle-line-init]} )); then
    zle zle-line-init "$@"
  elif [[ "\${widgets[zle-line-init]:-}" == user:__helix_prompt_mark ]]; then
    local __helix_prev_line_init_fn=""
    __helix_prompt_mark "$@"
  fi
}
# Run after user prompt hooks without copying their function metadata.
__helix_deferred_sched_init() {
  local __helix_prompt_status=$?
  builtin emulate -L zsh
  (( \${+functions[__helix_deferred_init]} )) && __helix_deferred_init
  builtin unset __helix_deferred_sched_armed
  builtin unfunction __helix_deferred_sched_init
  return $__helix_prompt_status
}
__helix_arm_deferred_line_init() {
  builtin emulate -L zsh
  if [[ "\${widgets[zle-line-init]:-}" != user:__helix_deferred_line_init ]]; then
    if (( \${+widgets[zle-line-init]} )); then
      zle -A zle-line-init __helix_saved_line_init
    fi
    zle -N zle-line-init __helix_deferred_line_init
  fi
  if (( ! $+__helix_deferred_sched_armed )) && builtin zmodload -F zsh/sched b:sched 2>/dev/null; then
    builtin sched +0 __helix_deferred_sched_init && builtin typeset -g __helix_deferred_sched_armed=1
  fi
}`

// Restore the prior widget before the readiness hook captures it.
export const ZSH_DEFERRED_LINE_INIT_RETIRE_BLOCK = `  if (( \${+widgets[__helix_saved_line_init]} )); then
    if [[ "\${widgets[zle-line-init]:-}" == user:__helix_deferred_line_init ]]; then
      zle -A __helix_saved_line_init zle-line-init
    fi
    zle -D __helix_saved_line_init
  elif [[ "\${widgets[zle-line-init]:-}" == user:__helix_deferred_line_init ]]; then
    zle -D zle-line-init
  fi`

// Plugin-copied callbacks stay inert after startup through their own guards.
export const ZSH_DEFERRED_LINE_INIT_CLEANUP_BLOCK = `  (( $+__helix_deferred_sched_armed )) || builtin unfunction __helix_deferred_sched_init`
