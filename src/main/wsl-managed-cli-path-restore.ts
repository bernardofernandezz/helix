/** Leads PATH with the managed WSL CLI after startup files ran; an unusable CLI only warns. */
export const WSL_MANAGED_CLI_PATH_RESTORE = `if [ -n "\${HELIX_WSL_CLI_DIR:-}" ]; then
  if [ -x "$HELIX_WSL_CLI_DIR/\${HELIX_CLI_COMMAND:-}" ]; then
    export PATH="$HELIX_WSL_CLI_DIR\${PATH:+:$PATH}"
  else
    printf 'Helix CLI unavailable: cannot run %s. Check WSL Windows-drive mount options.\\n' "$HELIX_WSL_CLI_DIR/\${HELIX_CLI_COMMAND:-}" >&2
  fi
fi`
