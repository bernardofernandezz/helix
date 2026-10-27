export const HELIX_CLI_POSIX_PATH_RESTORE = `if [ -n "\${HELIX_CLI_BIN_DIR:-}" ]; then
  case "\${PATH:-}" in
    "$HELIX_CLI_BIN_DIR"|"$HELIX_CLI_BIN_DIR":*) ;;
    *) export PATH="$HELIX_CLI_BIN_DIR\${PATH:+:$PATH}" ;;
  esac
fi`
