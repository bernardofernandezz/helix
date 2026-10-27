export const MANAGED_DATA_ACCOUNT_POSIX_RESTORE = `if [[ -n "\${HELIX_DATA_ACCOUNT_DATA_HOME:-}" ]]; then
  export XDG_DATA_HOME="\${HELIX_DATA_ACCOUNT_DATA_HOME}"
  export XDG_STATE_HOME="\${HELIX_DATA_ACCOUNT_STATE_HOME}"
  if [[ "\${HELIX_DATA_ACCOUNT_PROVIDER:-}" == opencode ]]; then
    export OPENCODE_AUTH_CONTENT=""
    export OPENCODE_DB="opencode.db"
  fi
fi`

export const MANAGED_DATA_ACCOUNT_POWERSHELL_RESTORE = `if ($env:HELIX_DATA_ACCOUNT_DATA_HOME) {
  $env:XDG_DATA_HOME = $env:HELIX_DATA_ACCOUNT_DATA_HOME
  $env:XDG_STATE_HOME = $env:HELIX_DATA_ACCOUNT_STATE_HOME
  if ($env:HELIX_DATA_ACCOUNT_PROVIDER -eq 'opencode') {
    $env:OPENCODE_AUTH_CONTENT = ''
    $env:OPENCODE_DB = 'opencode.db'
  }
}`

export const MANAGED_DATA_ACCOUNT_FISH_RESTORE = `        if set -q HELIX_DATA_ACCOUNT_DATA_HOME; and test -n "$HELIX_DATA_ACCOUNT_DATA_HOME"
            set -gx XDG_DATA_HOME "$HELIX_DATA_ACCOUNT_DATA_HOME"
            set -gx XDG_STATE_HOME "$HELIX_DATA_ACCOUNT_STATE_HOME"
            if test "$HELIX_DATA_ACCOUNT_PROVIDER" = opencode
                set -gx OPENCODE_AUTH_CONTENT ''
                set -gx OPENCODE_DB opencode.db
            end
        end`
