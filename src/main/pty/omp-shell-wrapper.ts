// Typed OMP needs Helix's status extension explicitly; preserve PI_CODING_AGENT_DIR as the user's mutable auth/config/session home.

const OMP_SUBCOMMANDS = [
  '__complete',
  'acp',
  'agents',
  'auth-broker',
  'auth-gateway',
  'bench',
  'commit',
  'completions',
  'config',
  'dry-balance',
  'gallery',
  'grep',
  'grievances',
  'install',
  'join',
  'models',
  'plugin',
  'read',
  'say',
  'search',
  'setup',
  'shell',
  'ssh',
  'stats',
  'tiny-models',
  'token',
  'ttsr',
  'update',
  'usage',
  'worktree',
  'q',
  'wt'
] as const

export function getPosixOmpShellWrapper(): string {
  const subcommands = OMP_SUBCOMMANDS.map((value) => `'${value}'`).join('|')
  return `# Why: OMP does not auto-load Helix's managed status extension; wrap only
# interactive launch invocations so subcommands such as \`omp config\` keep
# their normal argv shape.
__helix_omp_should_skip_extension() {
  case "\${1:-}" in
    'help'|'--help'|'-h'|'--version'|'-v') return 0 ;;
    ${subcommands}) return 0 ;;
  esac
  return 1
}
__helix_omp_cwd_is_usable() {
  local __helix_physical_cwd
  [[ -x . ]] || return 1
  if [[ -n "\${PWD:-}" && -d "\${PWD:-}" ]]; then
    [[ "\${PWD}" -ef . ]]
  else
    # Why compare the path: shell builtins can print a cached path for a deleted cwd.
    __helix_physical_cwd="$(builtin pwd -P 2>/dev/null)" || return 1
    [[ -d "$__helix_physical_cwd" && "$__helix_physical_cwd" -ef . ]]
  fi
}
__helix_omp_invoke() {
  local __helix_use_extension="$1"
  shift
  if [[ $__helix_use_extension -eq 1 && -n "\${HELIX_OMP_STATUS_EXTENSION:-}" && -f "\${HELIX_OMP_STATUS_EXTENSION}" ]]; then
    if [[ "\${1:-}" == "launch" ]]; then
      shift
      command omp launch --extension "\${HELIX_OMP_STATUS_EXTENSION}" "$@"
    else
      command omp --extension "\${HELIX_OMP_STATUS_EXTENSION}" "$@"
    fi
  else
    command omp "$@"
  fi
}
__helix_omp() {
  local __helix_use_extension=1
  __helix_omp_should_skip_extension "\${1:-}" && __helix_use_extension=0
  if ! __helix_omp_cwd_is_usable; then
    local __helix_logical_cwd="\${PWD:-\${HELIX_WORKTREE_PATH:-\${HELIX_ROOT_PATH:-}}}"
    # Why: a restored shell can retain the deleted directory inode after its path is recreated.
    (
      if [[ -z "$__helix_logical_cwd" ]]; then
        printf 'Helix: OMP cannot start because no terminal working directory is available. Open a new terminal in an existing directory.\\n' >&2
        return 1
      fi
      if ! builtin cd -P -- "$__helix_logical_cwd" 2>/dev/null; then
        printf 'Helix: OMP cannot access the terminal working directory "%s". Open a new terminal in an existing directory.\\n' "$__helix_logical_cwd" >&2
        return 1
      fi
      __helix_omp_invoke "$__helix_use_extension" "$@"
    )
  else
    __helix_omp_invoke "$__helix_use_extension" "$@"
  fi
}
if [[ -n "\${HELIX_OMP_STATUS_EXTENSION:-}" ]]; then
  # Why the function reserved word: it suppresses alias expansion of the name, which
  # an \`alias omp\` otherwise rewrites at parse time, aborting the rest of the file.
  function omp { __helix_omp "$@"; }
fi
`
}

export function getPowerShellOmpShellWrapper(): string {
  const subcommands = OMP_SUBCOMMANDS.map((value) => `'${value}'`).join(', ')
  return `# Why: OMP does not auto-load Helix's managed status extension; wrap only
# interactive launch invocations so subcommands such as \`omp config\` keep
# their normal argv shape.
function Global:__HelixOmpShouldSkipExtension {
    param([string]$Name)
    $skip = @("help", "--help", "-h", "--version", "-v") + @(${subcommands})
    return $skip -contains $Name
}
if ($env:HELIX_OMP_STATUS_EXTENSION) {
    function Global:omp {
        $helixUseExtension = -not (__HelixOmpShouldSkipExtension -Name ([string]($args[0])))
        $helixStatus = 0
        $helixCommand = Get-Command omp -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $helixCommand) {
            Write-Error "omp executable not found"
            $helixStatus = 127
        } elseif ($helixUseExtension -and $env:HELIX_OMP_STATUS_EXTENSION -and
            (Test-Path -LiteralPath $env:HELIX_OMP_STATUS_EXTENSION)) {
            if ($args.Count -gt 0 -and $args[0] -eq "launch") {
                $helixLaunchArgs = @($args | Select-Object -Skip 1)
                & $helixCommand.Source launch --extension $env:HELIX_OMP_STATUS_EXTENSION @helixLaunchArgs
            } else {
                & $helixCommand.Source --extension $env:HELIX_OMP_STATUS_EXTENSION @args
            }
            $helixStatus = $LASTEXITCODE
        } else {
            & $helixCommand.Source @args
            $helixStatus = $LASTEXITCODE
        }

        $global:LASTEXITCODE = $helixStatus
    }
}
`
}
