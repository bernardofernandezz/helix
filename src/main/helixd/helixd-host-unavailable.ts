// Remember repeatable deployment refusals per app version; host-fixable settings must be reprobed.

export class HelixdHostUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HelixdHostUnsupportedError'
  }
}

export class HelixdArtifactsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HelixdArtifactsUnavailableError'
  }
}

export class HelixdStdioBridgeUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HelixdStdioBridgeUnavailableError'
  }
}

export const HELIXD_TUNNEL_UNAVAILABLE_REASON = 'ssh_tunnel_unavailable'
export const HELIXD_WINDOWS_LAUNCH_REFUSED_CODE = 'helixd_windows_launch_refused'
export const HELIXD_WINDOWS_COMMAND_LINE_UNSAFE_CODE = 'helixd_windows_command_line_unsafe'

export type HelixdHostUnavailableReason =
  | 'unsupported_host'
  | 'artifacts_unavailable'
  | 'libc_unidentified'
  | 'runtime_self_test'
  | 'runtime_noexec'
  | 'windows_build_unsupported'
  | 'windows_no_extractor'
  | 'security_software'
  | 'native_preflight'
  | typeof HELIXD_TUNNEL_UNAVAILABLE_REASON

const UNAVAILABLE_BY_ERROR_NAME: Record<string, HelixdHostUnavailableReason> = {
  HelixdHostUnsupportedError: 'unsupported_host',
  HelixdArtifactsUnavailableError: 'artifacts_unavailable',
  HelixdRemoteLaunchUnsupportedError: 'unsupported_host',
  UnidentifiedHostLibcError: 'libc_unidentified',
  RemoteNodeRuntimeSelfTestError: 'runtime_self_test',
  RemoteNodeRuntimeNoexecError: 'runtime_noexec',
  RemoteWindowsBuildUnsupportedError: 'windows_build_unsupported',
  RemoteNodeRuntimeNoExtractorError: 'windows_no_extractor',
  RemoteNodeRuntimeSecurityModifiedError: 'security_software',
  HelixdStdioBridgeUnavailableError: HELIXD_TUNNEL_UNAVAILABLE_REASON,
  HelixdWindowsLaunchRefusedError: 'unsupported_host',
  HelixdWindowsCommandLineError: 'unsupported_host'
}

// Native preflight, PTY self-test and permanent Windows refusals repeat; transient races do not.
const UNAVAILABLE_BY_DEFERRAL_CODE: Record<string, HelixdHostUnavailableReason> = {
  helixd_candidate_preflight_failed: 'native_preflight',
  helixd_activation_pty_self_test_failed: 'native_preflight',
  [HELIXD_WINDOWS_LAUNCH_REFUSED_CODE]: 'unsupported_host',
  [HELIXD_WINDOWS_COMMAND_LINE_UNSAFE_CODE]: 'unsupported_host'
}

// Reprobed on every connect, so fixing or upgrading the host needs no new Helix version.
const FIXABLE_ON_HOST: ReadonlySet<string> = new Set<HelixdHostUnavailableReason>([
  'runtime_noexec',
  'windows_build_unsupported',
  'windows_no_extractor'
])

export function isHelixdHostUnavailableFixableOnHost(reason: string): boolean {
  return FIXABLE_ON_HOST.has(reason)
}

export function helixdCandidateLaunchFailureCode(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  return code === HELIXD_WINDOWS_LAUNCH_REFUSED_CODE ||
    code === HELIXD_WINDOWS_COMMAND_LINE_UNSAFE_CODE
    ? code
    : 'helixd_candidate_launch_failed'
}

export function classifyHelixdHostUnavailable(
  failure: unknown
): HelixdHostUnavailableReason | null {
  if (failure instanceof Error) {
    return UNAVAILABLE_BY_ERROR_NAME[failure.name] ?? null
  }
  if (failure && typeof failure === 'object' && 'code' in failure) {
    const code = failure.code
    return typeof code === 'string' ? (UNAVAILABLE_BY_DEFERRAL_CODE[code] ?? null) : null
  }
  return null
}
