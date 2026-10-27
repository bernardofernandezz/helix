/** One in-memory connection per distro: C4 launch, C5 stdio bridge and loopback-rewritten pairing. Rebind when helixd moves ports; C7 persists onChange results. */
import type {
  WslHelixdConnection,
  WslHelixdConnectionDependencies
} from './wsl-helixd-connection-types'
import {
  assertWslDistroMayStart,
  isQuietConnectFailure,
  WslHelixdConnectionSupersededError,
  WslHelixdLaunchDeferredError
} from './wsl-helixd-connection-errors'
import type { WslHostConnectIntent } from '../../shared/wsl-host-types'
import { errorMessage } from '../../shared/error-message'
import { parsePairingCode, type PairingOffer } from '../../shared/pairing'
import type { HelixdHostTransport } from '../ssh/helixd-host-transport'
import type { StartedPortForward } from '../ssh/port-forwarding/ssh-port-forward-provider'
import {
  wslConnectFailedStatus,
  type WslHelixdConnectionStatus
} from './wsl-helixd-connection-status'
import { wslDistroHolderKey } from './wsl-distro-holder-record'
import {
  defaultWslHelixdEnvironmentId,
  deployAndLaunchWslHelixd,
  type WslHelixdLaunch
} from './wsl-helixd-deploy'
import type { WslHelixdHostTarget } from './wsl-helixd-host-target'
import { createWslHelixdHostTransport } from './wsl-helixd-host-transport'
import { resolveWslHelixdPairing } from './wsl-helixd-pairing-identity'
import { trackWslHelixdHostEnvironment } from './wsl-helixd-host-environments'
import { listenWslHelixdStdioBridgeOnPreferredPort } from './wsl-helixd-stdio-bridge'

export type {
  WslHelixdConnection,
  WslHelixdConnectionDependencies
} from './wsl-helixd-connection-types'

export type WslHelixdConnectOptions = {
  environmentId?: string
  label?: string
  /** Rebinds a port a persisted pairing offer already names; 0 or absent picks a free one. */
  localPort?: number
  intent?: WslHostConnectIntent
  signal?: AbortSignal
  /** What `onChange` reports while this connect runs and once it is ready (liveness recovery). */
  status?: WslHelixdConnectStatus
  /** E9 no-boot reconnect: refuse unless this confirms the distro runs, right before any spawn. */
  requireRunning?: (distro: string) => Promise<boolean>
}

type WslHelixdConnectStatus = {
  pending: WslHelixdConnectionStatus
  ready: WslHelixdConnectionStatus
}

const CONNECTING: WslHelixdConnectionStatus = { state: 'connecting' }
const READY: WslHelixdConnectionStatus = { state: 'ready', census: null }

type ActiveWslHelixdConnection = {
  connection: WslHelixdConnection
  forward: StartedPortForward
}

export class WslHelixdConnectionManager {
  private readonly active = new Map<string, ActiveWslHelixdConnection>()
  private readonly inFlight = new Map<
    string,
    { promise: Promise<WslHelixdConnection>; noBoot: boolean }
  >()
  private readonly generations = new Map<string, number>()

  constructor(private readonly dependencies: WslHelixdConnectionDependencies = {}) {}

  /** Joins a connect already running for this distro rather than racing a second bridge. */
  ensure(distro: string, options: WslHelixdConnectOptions = {}): Promise<WslHelixdConnection> {
    const name = distro.trim()
    if (!name) {
      return Promise.reject(new Error('A WSL distro name is required'))
    }
    const key = wslDistroHolderKey(name)
    const pending = this.inFlight.get(key)
    if (pending) {
      if (!options.intent && (!pending.noBoot || options.requireRunning)) {
        return pending.promise
      }
      // Update/Force needs its own deploy, and a connect that may boot can't ride on one that may
      // not (it would refuse a stopped distro the user asked for); run after it instead.
      const generation = this.generation(key)
      return pending.promise
        .catch(() => {})
        .then(() => {
          if (this.generation(key) !== generation) {
            throw new WslHelixdConnectionSupersededError(name)
          }
          return this.ensure(distro, options)
        })
    }
    const status = options.status ?? { pending: CONNECTING, ready: READY }
    // Unchanged live refresh stays quiet; liveness recovery must publish.
    // A no-boot connect may be refused quietly, so it must not leave the row on "Connecting";
    // an explicit status (liveness recovery) is still published.
    if (options.status || (!this.active.has(key) && !options.requireRunning)) {
      this.dependencies.onChange?.(name, this.get(name), status.pending)
    }
    const operation = this.connect(name, key, options, status).catch((error: unknown) => {
      // Liveness owns reconnect status; superseded and no-boot-refused connects publish nothing.
      if (!options.status && !isQuietConnectFailure(error)) {
        const deferral = error instanceof WslHelixdLaunchDeferredError ? error.launch : null
        const failed = wslConnectFailedStatus(errorMessage(error), deferral)
        this.dependencies.onChange?.(name, this.get(name), failed)
      }
      throw error
    })
    const tracked: Promise<WslHelixdConnection> = operation.finally(() => {
      if (this.inFlight.get(key)?.promise === tracked) {
        this.inFlight.delete(key)
      }
    })
    this.inFlight.set(key, { promise: tracked, noBoot: Boolean(options.requireRunning) })
    return tracked
  }

  /** Prefer persisted enrollment; only unrecorded hosts fall back to their live connection offer. */
  private enrolledOffer(key: string, environmentId: string): PairingOffer | null {
    const current = this.active.get(key)?.connection
    return (
      this.dependencies.getPairingOffer?.(environmentId) ??
      (current?.environmentId === environmentId ? parsePairingCode(current.pairingOffer) : null)
    )
  }

  get(distro: string): WslHelixdConnection | null {
    return this.active.get(wslDistroHolderKey(distro))?.connection ?? null
  }

  /** Liveness reports a status change for a distro, with whatever connection it has now. */
  publish(distro: string, status: WslHelixdConnectionStatus): void {
    this.dependencies.onChange?.(distro, this.get(distro), status)
  }

  list(): WslHelixdConnection[] {
    return [...this.active.values()].map((entry) => entry.connection)
  }

  async close(distro: string): Promise<void> {
    const key = wslDistroHolderKey(distro)
    this.generations.set(key, this.generation(key) + 1)
    const entry = this.active.get(key)
    if (!entry) {
      return
    }
    await this.drop(key, entry)
    this.dependencies.onChange?.(entry.connection.distro, null, { state: 'closed' })
  }

  /** Retires one bridge; unlike close, a connect queued behind it still runs. */
  private async drop(key: string, entry: ActiveWslHelixdConnection): Promise<void> {
    if (this.active.get(key) === entry) {
      this.active.delete(key)
    }
    await entry.forward.close()
    trackWslHelixdHostEnvironment(entry.connection, null)
  }

  async dispose(): Promise<void> {
    const keys = new Set([...this.active.keys(), ...this.inFlight.keys()])
    await Promise.all([...keys].map((key) => this.close(key)))
  }

  private generation(key: string): number {
    return this.generations.get(key) ?? 0
  }

  private async connect(
    distro: string,
    key: string,
    options: WslHelixdConnectOptions,
    status: WslHelixdConnectStatus
  ): Promise<WslHelixdConnection> {
    // Taken before any await, so a close during the running-list read still supersedes this.
    const generation = this.generation(key)
    const stillCurrent = (): boolean => this.generation(key) === generation
    await assertWslDistroMayStart(distro, options.requireRunning, stillCurrent)
    const environmentId = options.environmentId ?? defaultWslHelixdEnvironmentId(distro)
    const label = options.label ?? distro
    const target = { kind: 'wsl', id: environmentId, distro, label } as const
    const transport = (this.dependencies.createTransport ?? defaultTransport)(target)
    // Relaunch stopped helixd on each connect so distro restarts recover.
    const launch = await (this.dependencies.deployAndLaunch ?? deployAndLaunchWslHelixd)(distro, {
      environmentId,
      label,
      intent: options.intent,
      pairedOffer: this.enrolledOffer(key, environmentId),
      signal: options.signal,
      holder: this.dependencies.holder,
      createTransport: () => transport
    })
    if (launch.outcome === 'deferred') {
      throw new WslHelixdLaunchDeferredError(launch)
    }
    if (this.generation(key) !== generation) {
      throw new WslHelixdConnectionSupersededError(distro)
    }
    const current = this.active.get(key)
    const persisted = this.dependencies.getPairingOffer?.(environmentId) ?? null
    const paired = persisted ?? this.enrolledOffer(key, environmentId)
    // Repair only persisted enrollment; an in-progress Add has no stored record to repair.
    const recovery =
      persisted && this.dependencies.pairingRecovery
        ? { ...this.dependencies.pairingRecovery, environmentId }
        : undefined
    if (
      current &&
      current.connection.remotePort === launch.port &&
      current.connection.environmentId === environmentId
    ) {
      const pairingOffer = await resolveWslHelixdPairing(
        launch,
        current.connection.localPort,
        paired,
        this.dependencies.verifyIdentity,
        recovery
      ).catch(async (error: unknown) => {
        // Retire the rejected bridge or publishing its stale token would overwrite pairing repaired by the gate.
        await this.drop(key, current)
        throw error
      })
      if (this.generation(key) !== generation) {
        throw new WslHelixdConnectionSupersededError(distro)
      }
      return this.refreshOffer(
        key,
        current,
        launch,
        pairingOffer,
        options.status ? status.ready : null
      )
    }
    // Port changes invalidate the old bridge; reuse its local port, else the recorded one, when possible.
    const preferredLocalPort =
      current?.connection.localPort ??
      options.localPort ??
      this.dependencies.recordedLocalPort?.(environmentId) ??
      0
    if (current) {
      await this.drop(key, current)
      this.dependencies.onChange?.(distro, null, status.pending)
    }
    const forward = await listenWslHelixdStdioBridgeOnPreferredPort(
      transport,
      {
        environmentId,
        remotePort: launch.port,
        localPort: preferredLocalPort,
        label: `Helix server in WSL: ${label}`
      },
      this.dependencies.listen
    )
    try {
      if (this.generation(key) !== generation) {
        throw new WslHelixdConnectionSupersededError(distro)
      }
      const pairingOffer = await resolveWslHelixdPairing(
        launch,
        forward.entry.localPort,
        paired,
        this.dependencies.verifyIdentity,
        recovery
      )
      if (this.generation(key) !== generation) {
        throw new WslHelixdConnectionSupersededError(distro)
      }
      const entry: ActiveWslHelixdConnection = {
        forward,
        connection: {
          distro,
          environmentId,
          localPort: forward.entry.localPort,
          remotePort: launch.port,
          fullVersion: launch.fullVersion,
          pid: launch.pid,
          pairingOffer,
          deferredUpdate: launch.deferredUpdate ?? null,
          close: () => this.closeEntry(key, entry)
        }
      }
      this.active.set(key, entry)
      trackWslHelixdHostEnvironment(entry.connection, entry.connection)
      this.dependencies.onChange?.(distro, entry.connection, status.ready)
      return entry.connection
    } catch (error) {
      await forward.close()
      throw error
    }
  }

  private refreshOffer(
    key: string,
    entry: ActiveWslHelixdConnection,
    launch: Extract<WslHelixdLaunch, { outcome: 'ready' }>,
    pairingOffer: string,
    /** Reported even when nothing changed; null stays quiet then. */
    announce: WslHelixdConnectionStatus | null
  ): WslHelixdConnection {
    const deferredUpdate = launch.deferredUpdate ?? null
    const changed =
      pairingOffer !== entry.connection.pairingOffer ||
      launch.fullVersion !== entry.connection.fullVersion ||
      launch.pid !== entry.connection.pid ||
      JSON.stringify(deferredUpdate) !== JSON.stringify(entry.connection.deferredUpdate)
    if (changed) {
      const { fullVersion, pid } = launch
      entry.connection = { ...entry.connection, pairingOffer, fullVersion, pid, deferredUpdate }
      this.active.set(key, entry)
    }
    trackWslHelixdHostEnvironment(entry.connection, entry.connection)
    if (changed || announce) {
      this.dependencies.onChange?.(entry.connection.distro, entry.connection, announce ?? READY)
    }
    return entry.connection
  }

  private async closeEntry(key: string, entry: ActiveWslHelixdConnection): Promise<void> {
    if (this.active.get(key) === entry) {
      await this.close(key)
    }
  }
}

function defaultTransport(target: WslHelixdHostTarget): HelixdHostTransport {
  return createWslHelixdHostTransport({ target })
}
