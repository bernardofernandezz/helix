// Remember failures only for this session so restarting retries once.
export type HelixdUpdateFailureHost = { kind: 'ssh' | 'wsl'; id: string }

export type HelixdUpdateFailure = { code: string; reason: string }

const failedThisLaunch = new Map<string, HelixdUpdateFailure>()

function key(host: HelixdUpdateFailureHost): string {
  return `${host.kind}:${host.id}`
}

export function recordHelixdUpdateFailedThisLaunch(
  host: HelixdUpdateFailureHost,
  failure: HelixdUpdateFailure
): void {
  failedThisLaunch.set(key(host), failure)
}

export function helixdUpdateFailureThisLaunch(
  host: HelixdUpdateFailureHost
): HelixdUpdateFailure | null {
  return failedThisLaunch.get(key(host)) ?? null
}

export function helixdUpdateFailedThisLaunch(host: HelixdUpdateFailureHost): boolean {
  return failedThisLaunch.has(key(host))
}

export function clearHelixdUpdateFailedThisLaunch(host: HelixdUpdateFailureHost): void {
  failedThisLaunch.delete(key(host))
}

export function resetHelixdUpdateFailuresForTests(): void {
  failedThisLaunch.clear()
}
