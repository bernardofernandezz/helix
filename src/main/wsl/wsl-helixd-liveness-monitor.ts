import type {
  Supervised,
  Trigger,
  WslHelixdLivenessDependencies,
  WslHelixdTimer
} from './wsl-helixd-liveness-state'
import { wslHelixdVerifyRetryDelayMs } from './wsl-helixd-reconnect-backoff'
import type { WslHelixdWatch } from './wsl-helixd-watch'

export function defaultSchedule(delayMs: number, task: () => void): WslHelixdTimer {
  const timer = setTimeout(task, delayMs)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}

/** `onChange(false)` on a real resume only: subscribing reports the current state at once. */
export function subscribeWake(
  subscribePower: WslHelixdLivenessDependencies['subscribePower'],
  onChange: (suspended: boolean) => void
): () => void {
  let subscribed = false
  const unsubscribe = subscribePower?.({
    onSuspend: () => onChange(true),
    onResume: () => {
      if (subscribed) {
        onChange(false)
      }
    }
  })
  subscribed = true
  return unsubscribe ?? (() => {})
}

/** A backoff wait that `disarm` ends early through `wakeWait`. */
export function cancellableWait(
  entry: Supervised,
  schedule: (delayMs: number, task: () => void) => WslHelixdTimer,
  delayMs: number
): Promise<void> {
  return new Promise<void>((resolve) => {
    entry.wakeWait = resolve
    entry.timer = schedule(delayMs, resolve)
  }).finally(() => {
    entry.timer = null
    entry.wakeWait = null
  })
}

export async function ensureHolderQuietly(
  ensureHolder: WslHelixdLivenessDependencies['ensureHolder'],
  distro: string
): Promise<void> {
  try {
    await ensureHolder?.(distro)
  } catch (error) {
    console.warn(`[wsl] holder re-ensure for ${distro} failed:`, error)
  }
}

/** Holds a new watch unless a later connect superseded this one or already holds one. */
export async function attachSupervisedWatch(
  entry: Supervised,
  openWatch: () => Promise<WslHelixdWatch>,
  onExit: (code: number | null) => void
): Promise<WslHelixdWatch['signal']> {
  const generation = entry.generation
  const watch = await openWatch()
  if (watch.signal !== 'ready') {
    return watch.signal
  }
  if (entry.generation !== generation || entry.watch) {
    watch.close()
    return 'ready'
  }
  entry.watch = watch
  watch.onExit((code) => {
    if (entry.watch === watch) {
      entry.watch = null
      onExit(code)
    }
  })
  return 'ready'
}

type SupervisedClock = {
  now: () => number
  schedule: (delayMs: number, task: () => void) => WslHelixdTimer
  heartbeatMs: number
}

export function scheduleSupervisedHeartbeat(
  entry: Supervised,
  clock: SupervisedClock,
  trigger: (trigger: Trigger) => void
): void {
  entry.timer?.cancel()
  entry.lastBeatMs = clock.now()
  entry.timer = clock.schedule(clock.heartbeatMs, () => {
    entry.timer = null
    // Long-overdue ticks imply process/VM suspension; reverify all evidence.
    const late = clock.now() - entry.lastBeatMs > clock.heartbeatMs * 2
    trigger(late ? { source: 'verify' } : 'heartbeat')
  })
}

export function scheduleSupervisedVerify(
  entry: Supervised,
  schedule: SupervisedClock['schedule'],
  trigger: (trigger: Trigger) => void
): void {
  entry.timer?.cancel()
  const delayMs = wslHelixdVerifyRetryDelayMs(entry.verifyStreak)
  entry.verifyStreak += 1
  entry.timer = schedule(delayMs, () => {
    entry.timer = null
    trigger({ source: 'verify' })
  })
}
