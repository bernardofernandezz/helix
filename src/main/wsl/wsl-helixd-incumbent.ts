/** E1: open a temporary bridge for incumbent census before activation. Unproven state is unverifiable, never zero; WSL has no standing deploy tunnel. */
import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { parsePairingCode, type PairingOffer } from '../../shared/pairing'
import { HELIXD_MANAGED_REMOTE_PORT } from '../../shared/helixd-managed-runtime'
import {
  type HelixdTerminalCensus,
  UNVERIFIABLE_HELIXD_TERMINAL_CENSUS
} from '../../shared/helixd-terminal-census'
import type { ServeReadiness } from '../server/serve-readiness'
import { probeActiveHelixdReadiness } from '../ssh/helixd-active-readiness'
import { helixdBoundPort } from '../managed-server/lifecycle/helixd-managed-bound-port'
import { managedHelixdInstallDir } from '../managed-server/lifecycle/helixd-managed-runtime-context'
import { wakeStoppedManagedHelixd } from '../managed-server/lifecycle/helixd-managed-wake'
import type { HelixdRemoteContext } from '../managed-server/install/helixd-remote-context'
import type { HelixdSlotOptions } from '../ssh/helixd-recovery-slot'
import { readRemoteHelixdBuildHash } from '../managed-server/install/helixd-remote-build-hash'
import {
  requestHelixdTerminalCensus,
  type HelixdTerminalCensusRequestOptions
} from '../ssh/helixd-terminal-census-client'
import { updateTerminalCounts } from '../ssh/helixd-fenced-stop'
import { tunneledHelixdPairingCode } from '../ssh/helixd-tunneled-pairing'
import type { StartedPortForward } from '../ssh/port-forwarding/ssh-port-forward-provider'
import type { HelixdHostTransport } from '../ssh/helixd-host-transport'
import type { WslHelixdHostTarget } from './wsl-helixd-host-target'
import { listenWslHelixdStdioBridge } from './wsl-helixd-stdio-bridge'

export type WslHelixdIncumbent = {
  census: HelixdTerminalCensus
  /** The incumbent's proven readiness; null when it could not be started or proven. */
  readiness: ServeReadiness | null
  /** Recount without wake and close terminal admission before activation stops the incumbent; unreadable never means zero. */
  recount: () => Promise<HelixdTerminalCensus>
  /** Reopens the admission `recount` closed, when the incumbent keeps running. */
  releaseAdmission: () => Promise<void>
}

type IncumbentArgs = {
  context: HelixdRemoteContext<WslHelixdHostTarget>
  slot: HelixdSlotOptions
  /** This desktop's enrolled pairing; null before its first pairing. */
  paired?: PairingOffer | null
}

const UNREADABLE: WslHelixdIncumbent = {
  census: UNVERIFIABLE_HELIXD_TERMINAL_CENSUS,
  readiness: null,
  recount: async () => UNVERIFIABLE_HELIXD_TERMINAL_CENSUS,
  releaseAdmission: async () => {}
}

export type WslHelixdIncumbentDependencies = {
  wake: typeof wakeStoppedManagedHelixd
  probe: typeof probeActiveHelixdReadiness
  readBuildHash: typeof readRemoteHelixdBuildHash
  listen: (
    transport: HelixdHostTransport,
    remotePort: number,
    target: WslHelixdHostTarget
  ) => Promise<StartedPortForward>
  census: typeof requestHelixdTerminalCensus
}

const DEFAULT_DEPENDENCIES: WslHelixdIncumbentDependencies = {
  wake: wakeStoppedManagedHelixd,
  probe: probeActiveHelixdReadiness,
  readBuildHash: readRemoteHelixdBuildHash,
  listen: (transport, remotePort, target) =>
    listenWslHelixdStdioBridge(transport, {
      environmentId: target.id,
      remotePort,
      localPort: 0,
      label: `Helix server in WSL: ${target.label} (update check)`
    }),
  census: requestHelixdTerminalCensus
}

/** Wake reboot/idle-stopped incumbent, census its daemon, then close the temporary bridge before returning. */
export async function readWslHelixdIncumbent(
  args: IncumbentArgs,
  dependencies: WslHelixdIncumbentDependencies = DEFAULT_DEPENDENCIES
): Promise<WslHelixdIncumbent> {
  const record = args.context.activationRecord
  const activatedAt = record.activatedAt ? Date.parse(record.activatedAt) : Number.NaN
  if (!record.active || !Number.isFinite(activatedAt) || activatedAt < 0) {
    return UNREADABLE
  }
  let readiness: ServeReadiness
  try {
    const wake = await dependencies.wake(args.slot)
    if (wake.outcome === 'started') {
      readiness = wake.readiness
    } else if (wake.outcome === 'serving') {
      const remoteInstallDir = managedHelixdInstallDir(args.context, record.active)
      readiness = await dependencies.probe(
        { ...args.slot, remoteInstallDir },
        {
          buildHash: await dependencies.readBuildHash(args.slot, remoteInstallDir),
          fullVersion: record.active
        }
      )
    } else {
      return UNREADABLE
    }
  } catch {
    return UNREADABLE
  }
  const counts = updateTerminalCounts((options) =>
    countIncumbentTerminals(args, readiness, activatedAt, dependencies, options)
  )
  return {
    census: await counts.countFirst(),
    readiness,
    recount: counts.recountCensus,
    releaseAdmission: counts.releaseIncumbentAdmission
  }
}

async function countIncumbentTerminals(
  args: IncumbentArgs,
  readiness: ServeReadiness,
  activatedAt: number,
  dependencies: WslHelixdIncumbentDependencies,
  options: HelixdTerminalCensusRequestOptions
): Promise<HelixdTerminalCensus> {
  let forward: StartedPortForward | null = null
  try {
    forward = await dependencies.listen(
      args.slot.conn,
      helixdBoundPort(readiness) ?? HELIXD_MANAGED_REMOTE_PORT,
      args.context.target
    )
    // Use enrolled grants; startup offers would enroll a fresh device on every census.
    const offer = parsePairingCode(
      tunneledHelixdPairingCode(readiness, forward.entry.localPort, args.paired)
    )
    if (!offer) {
      return UNVERIFIABLE_HELIXD_TERMINAL_CENSUS
    }
    return await dependencies.census(
      pairedRuntimeConnectionFromOffer(offer),
      activatedAt,
      undefined,
      options
    )
  } catch {
    return UNVERIFIABLE_HELIXD_TERMINAL_CENSUS
  } finally {
    await forward?.close().catch(() => {})
  }
}
