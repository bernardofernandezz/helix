/** D2c/C6 classify watch exits against fresh running lists and guest incarnation, publishing through onChange. Boot only for visible demand; background work waits for running evidence. Use monotonic timers and reverify after resume. */
import type { WslHelixdConnection } from './wsl-helixd-connection'
import { WslDistroNotRunningError } from './wsl-helixd-connection-errors'
import type {
  WslHelixdConnectIntent,
  WslHelixdConnectionStatus
} from './wsl-helixd-connection-status'
import { wslDistroHolderKey } from './wsl-distro-holder-record'
import { recoverWslHelixd, type WslHelixdRecoveryReason } from './wsl-helixd-liveness-recovery'
import {
  confirmsRunning,
  EXIT_SETTLE_MS,
  gatherWslLivenessEvidence
} from './wsl-helixd-liveness-evidence'
import {
  attachSupervisedWatch,
  cancellableWait,
  defaultSchedule,
  ensureHolderQuietly,
  scheduleSupervisedHeartbeat,
  scheduleSupervisedVerify,
  subscribeWake
} from './wsl-helixd-liveness-monitor'
import {
  disarmSupervised,
  isSupervisedSettling,
  isWatchOrHolderExit,
  noteSupervisedExit,
  newSupervised,
  WSL_HELIXD_HEARTBEAT_MS,
  type Supervised,
  type Trigger,
  type WslHelixdLivenessDependencies,
  type WslHelixdTimer
} from './wsl-helixd-liveness-state'
import {
  classifyWslHelixdLiveness,
  type WslLivenessEvidence,
  type WslLivenessVerdict
} from './wsl-helixd-liveness-verdict'
import { WslHelixdReconnectBackoff } from './wsl-helixd-reconnect-backoff'

export class WslHelixdLivenessSupervisor {
  private readonly supervised = new Map<string, Supervised>()
  private readonly now: () => number
  private readonly schedule: (delayMs: number, task: () => void) => WslHelixdTimer
  private readonly heartbeatMs: number
  private readonly unsubscribePower: () => void
  private suspended = false

  constructor(private readonly deps: WslHelixdLivenessDependencies) {
    this.now = deps.monotonicNow ?? (() => performance.now())
    this.schedule = deps.schedule ?? defaultSchedule
    this.heartbeatMs = deps.heartbeatMs ?? WSL_HELIXD_HEARTBEAT_MS
    this.unsubscribePower = subscribeWake(deps.subscribePower, (suspended) => {
      this.suspended = suspended
      if (!suspended) {
        for (const entry of this.supervised.values()) {
          this.trigger(entry, { source: 'verify' })
        }
      }
    })
  }

  /** User-initiated, so it may boot the distro. Resolves once the watch is armed. */
  async connect(
    distro: string,
    options: WslHelixdConnectIntent = {}
  ): Promise<WslHelixdConnection> {
    const entry = this.entryFor(distro)
    // Clear prior failures even if the bridge offer is unchanged.
    const reportReady = entry.busy || (entry.state !== null && entry.state !== 'ready')
    // Explicit connect supersedes pending recovery/rechecks and owns rearming.
    const generation = (entry.generation += 1)
    disarmSupervised(entry)
    let connection: WslHelixdConnection
    try {
      connection = await this.deps.manager.ensure(entry.distro, options)
    } catch (error) {
      // Rejected updates may leave the incumbent serving; keep it watched.
      const incumbent = this.deps.manager.get(entry.distro)
      if (error instanceof WslDistroNotRunningError && entry.generation === generation) {
        // Arming would dial into the distro; liveness, not the refused poll, gives the verdict.
        this.trigger(entry, { source: 'verify' })
      } else if (incumbent && entry.generation === generation) {
        await this.arm(entry, incumbent)
      }
      throw error
    }
    if (entry.generation === generation) {
      entry.backoff.reset()
      await this.arm(entry, connection)
      if (reportReady && entry.generation === generation) {
        this.publish(entry, { state: 'ready', census: null })
      }
    }
    return connection
  }

  noteHolderExit(distro: string, exit: { code: number | null }): void {
    const entry = this.supervised.get(wslDistroHolderKey(distro))
    if (entry) {
      this.trigger(entry, { source: 'holder', code: exit.code })
    }
  }

  async stop(distro: string): Promise<void> {
    const key = wslDistroHolderKey(distro)
    const entry = this.supervised.get(key)
    if (entry) {
      entry.generation += 1
      disarmSupervised(entry)
      this.supervised.delete(key)
    }
    await this.deps.manager.close(distro)
  }

  async dispose(): Promise<void> {
    this.unsubscribePower()
    await Promise.all([...this.supervised.values()].map((entry) => this.stop(entry.distro)))
  }

  /** E9: a poll must wait for this distro's verdict rather than reconnect (see the helper). */
  isSettling(distro: string): boolean {
    return isSupervisedSettling(this.supervised.get(wslDistroHolderKey(distro)), this.now())
  }

  private entryFor(distro: string): Supervised {
    const key = wslDistroHolderKey(distro)
    const existing = this.supervised.get(key)
    if (existing) {
      return existing
    }
    const backoff = new WslHelixdReconnectBackoff(this.deps.random)
    const entry = newSupervised(distro, key, this.now(), backoff)
    this.supervised.set(key, entry)
    return entry
  }

  private publish(entry: Supervised, status: WslHelixdConnectionStatus): void {
    entry.state = status.state
    this.deps.manager.publish(entry.distro, status)
  }

  /** Records who this helixd is and holds the watch; that identity anchors every later verdict. */
  private async arm(entry: Supervised, connection: WslHelixdConnection): Promise<void> {
    const generation = entry.generation
    const identity = await this.deps.readIdentity(entry.distro, connection.pid)
    if (entry.generation !== generation) {
      return
    }
    entry.expected = {
      distroInstance: identity?.distroInstance ?? null,
      helixd: identity?.helixd ?? null
    }
    entry.state = 'ready'
    entry.verifyStreak = 0
    entry.backoff.noteReady(this.now())
    if (!entry.watch && (await this.attachWatch(entry, connection)) !== 'ready') {
      if (entry.generation === generation) {
        this.scheduleVerify(entry)
      }
      return
    }
    // Do not overwrite the timer owned by a superseding connect.
    if (entry.generation === generation) {
      this.scheduleHeartbeat(entry)
    }
  }

  private attachWatch(entry: Supervised, connection: WslHelixdConnection) {
    return attachSupervisedWatch(
      entry,
      () => this.deps.openWatch(connection),
      (code) => this.trigger(entry, { source: 'bridge', code })
    )
  }

  private scheduleHeartbeat(entry: Supervised): void {
    const clock = { now: this.now, schedule: this.schedule, heartbeatMs: this.heartbeatMs }
    scheduleSupervisedHeartbeat(entry, clock, (trigger) => this.trigger(entry, trigger))
  }

  private scheduleVerify(entry: Supervised): void {
    scheduleSupervisedVerify(entry, this.schedule, (trigger) => this.trigger(entry, trigger))
  }

  private trigger(entry: Supervised, trigger: Trigger): void {
    if (this.supervised.get(entry.key) !== entry || (this.suspended && trigger === 'heartbeat')) {
      return
    }
    noteSupervisedExit(entry, trigger, this.now())
    if (entry.busy) {
      // An exit or a re-verify outranks a heartbeat.
      if (entry.pending === null || trigger !== 'heartbeat') {
        entry.pending = trigger
      }
      return
    }
    entry.busy = true
    void this.run(entry, trigger)
      .catch((error: unknown) => console.warn(`[wsl] liveness of ${entry.distro} failed:`, error))
      .finally(() => {
        entry.busy = false
        const next = entry.pending
        entry.pending = null
        if (next) {
          this.trigger(entry, next)
        }
      })
  }

  private async run(entry: Supervised, trigger: Trigger): Promise<void> {
    const generation = entry.generation
    let running = await this.deps.readRunning()
    if (entry.generation !== generation) {
      return
    }
    if (isWatchOrHolderExit(trigger) && confirmsRunning(running, entry.key)) {
      // Stopping distros can still appear running; wait before exec accidentally boots them again.
      await new Promise<void>((resolve) => this.schedule(EXIT_SETTLE_MS, resolve))
      running = await this.deps.readRunning()
      if (entry.generation !== generation) {
        return
      }
    }
    if (trigger === 'heartbeat' && entry.watch && confirmsRunning(running, entry.key)) {
      await ensureHolderQuietly(this.deps.ensureHolder, entry.distro)
      this.scheduleHeartbeat(entry)
      return
    }
    const evidence: WslLivenessEvidence = {
      trigger: trigger === 'heartbeat' ? { source: 'verify' } : trigger,
      running:
        running.status === 'confirmed'
          ? { status: 'confirmed', running: confirmsRunning(running, entry.key) }
          : { status: 'unavailable' },
      expected: entry.expected
    }
    const connection = this.deps.manager.get(entry.distro)
    await gatherWslLivenessEvidence(evidence, {
      readIdentity: () => this.deps.readIdentity(entry.distro, connection?.pid ?? null),
      // A held watch proves the port; opening a fresh one is the probe.
      probePort: async () =>
        connection && !entry.watch ? this.attachWatch(entry, connection) : 'ready'
    })
    if (entry.generation === generation) {
      await this.act(entry, classifyWslHelixdLiveness(evidence))
    }
  }

  private async act(entry: Supervised, verdict: WslLivenessVerdict): Promise<void> {
    switch (verdict.kind) {
      case 'live': {
        entry.verifyStreak = 0
        const connection = this.deps.manager.get(entry.distro)
        if (!entry.watch && connection) {
          await this.attachWatch(entry, connection)
        }
        if (entry.state !== 'ready') {
          this.publish(entry, { state: 'ready', census: null })
        }
        await ensureHolderQuietly(this.deps.ensureHolder, entry.distro)
        this.scheduleHeartbeat(entry)
        return
      }
      case 'unverifiable':
        // Lost contact is not death; retain surviving watches and recheck.
        if (entry.state !== 'unverifiable') {
          this.publish(entry, {
            state: 'unverifiable',
            reason: verdict.reason,
            terminals: 'unverifiable'
          })
        }
        this.scheduleVerify(entry)
        return
      case 'distro-stopped':
        return this.onDistroStopped(entry)
      case 'distro-restarted':
        disarmSupervised(entry)
        return this.recover(entry, 'distro-restarted')
      case 'helixd-exited':
        disarmSupervised(entry)
        if (!this.deps.hasUserVisibleWork(entry.distro)) {
          // Relaunch without visible demand would defeat managed helixd idle exit.
          this.publish(entry, { state: 'idle', terminals: 'unverifiable' })
          return
        }
        return this.recover(entry, 'helixd-exited')
    }
  }

  private async onDistroStopped(entry: Supervised): Promise<void> {
    disarmSupervised(entry)
    // Holder and watch exit together; publish distro-stop once.
    if (entry.state !== 'distro-stopped') {
      this.publish(entry, { state: 'distro-stopped', terminals: 'exited', recovering: false })
    }
    // A confirmed stop stays down, even with visible work, until the user or a running distro (E9).
    const generation = entry.generation
    this.deps.deferUntilRunning(entry.distro, `wsl-helixd-liveness:${entry.key}`, () => {
      if (entry.generation === generation) {
        this.trigger(entry, { source: 'verify' })
      }
    })
  }

  private async recover(entry: Supervised, reason: WslHelixdRecoveryReason): Promise<void> {
    const generation = entry.generation
    // Recovery is never a user act: its reconnect re-checks the distro runs right before spawning.
    const requireRunning = this.deps.requireRunning
    const gated = await recoverWslHelixd(
      {
        distro: entry.distro,
        backoff: entry.backoff,
        now: this.now,
        current: () => entry.generation === generation,
        wait: (delayMs) => cancellableWait(entry, this.schedule, delayMs),
        publish: (status) => this.publish(entry, status),
        ensure: (options) => this.deps.manager.ensure(entry.distro, { ...options, requireRunning }),
        collectCensus: this.deps.collectCensus,
        arm: (connection) => this.arm(entry, connection),
        readRunning: this.deps.readRunning
      },
      reason
    )
    if (gated && entry.generation === generation) {
      await this.act(entry, gated)
    }
  }
}
