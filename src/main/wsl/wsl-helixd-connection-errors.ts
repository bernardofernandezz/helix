import type { WslHelixdLaunch } from './wsl-helixd-deploy'

type WslHelixdDeferredLaunch = Extract<WslHelixdLaunch, { outcome: 'deferred' }>

/** helixd installed an update it may not activate yet (live terminals); nothing is listening. */
export class WslHelixdLaunchDeferredError extends Error {
  constructor(readonly launch: WslHelixdDeferredLaunch) {
    super(launch.reason)
    this.name = 'WslHelixdLaunchDeferredError'
  }
}

/** A no-boot reconnect found the distro not confirmed running, so nothing was started. */
export class WslDistroNotRunningError extends Error {
  constructor(distro: string) {
    super(
      `The WSL distro ${distro} isn’t running, so Helix didn’t start it for a background request.`
    )
    this.name = 'WslDistroNotRunningError'
  }
}

export class WslHelixdConnectionSupersededError extends Error {
  constructor(distro: string) {
    super(`The connection to the WSL distro ${distro} was closed while it was being opened.`)
    this.name = 'WslHelixdConnectionSupersededError'
  }
}

/** A no-boot connect re-reads the running list just before anything spawns in the distro. */
export async function assertWslDistroMayStart(
  distro: string,
  requireRunning: ((distro: string) => Promise<boolean>) | undefined,
  isCurrent: () => boolean
): Promise<void> {
  if (!requireRunning) {
    return
  }
  const running = await requireRunning(distro)
  // A close during the read supersedes this connect before it deploys anything.
  if (!isCurrent()) {
    throw new WslHelixdConnectionSupersededError(distro)
  }
  if (!running) {
    throw new WslDistroNotRunningError(distro)
  }
}

/** Failures the connection's status must not report as `failed`: liveness owns those verdicts. */
export function isQuietConnectFailure(error: unknown): boolean {
  return (
    error instanceof WslHelixdConnectionSupersededError || error instanceof WslDistroNotRunningError
  )
}
