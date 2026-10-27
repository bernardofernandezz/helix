/** D1/D2b/D8 reuse SSH installation, activation journals/fences and admission over wsl.exe. C5 pairs through the reported loopback port. */
import { getAppEnvironment } from '../../shared/app-environment'
import type { PairingOffer } from '../../shared/pairing'
import { HELIXD_MANAGED_REMOTE_PORT } from '../../shared/helixd-managed-runtime'
import type { ServeReadiness } from '../server/serve-readiness'
import type { WslHostDeferredUpdate } from '../../shared/wsl-host-types'
import { recoverInterruptedHelixdActivation } from '../managed-server/activation/helixd-activation-recovery'
import { readHelixdActivationRecord } from '../managed-server/activation/helixd-activation-record-store'
import { readHelixdActivationTransaction } from '../managed-server/activation/helixd-activation-transaction-store'
import { materializeHelixdArtifact } from '../helixd/helixd-artifact-materializer'
import { HelixdHostUnsupportedError } from '../helixd/helixd-host-unavailable'
import type { HelixdHostTransport } from '../ssh/helixd-host-transport'
import { HELIXD_ACTIVATION_POLICY_REFUSED_CODE } from '../ssh/helixd-installed-activation'
import { helixdBoundPort } from '../managed-server/lifecycle/helixd-managed-bound-port'
import {
  isForceableHelixdDeferral,
  managedHelixdDeployPolicy,
  managedHelixdInstallDir,
  managedHelixdSlot,
  probeManagedHelixdReadiness
} from '../managed-server/lifecycle/helixd-managed-runtime-context'
import { isWaitingHelixdUpdateDeferral } from '../managed-server/lifecycle/helixd-managed-auto-update'
import { clearHelixdUpdateFailedThisLaunch } from '../managed-server/lifecycle/helixd-managed-update-failure-memory'
import type { HelixdUpdateIntent } from '../managed-server/lifecycle/helixd-managed-update-decision'
import type { HelixdActivationRecord } from '../managed-server/activation/helixd-activation-record'
import { errorMessage } from '../../shared/error-message'
import { pruneManagedHelixdVersions } from '../managed-server/lifecycle/helixd-managed-version-gc'
import { wakeAlreadyActiveHelixd } from '../ssh/helixd-already-active-wake'
import { resolveHelixdRemoteContext } from '../managed-server/install/helixd-remote-context'
import { deployHelixd } from '../ssh/helixd-remote-deploy'
import { HELIXD_PID_FILENAME } from '../managed-server/install/helixd-remote-host-support'
import { quotePosixShell } from '../../shared/shell-argument-quoting'
import { execCommand } from '../ssh/remote-exec/remote-exec-command'
import { joinRemotePath } from '../ssh/ssh-remote-platform'
import { readLocalFullVersion } from '../managed-server/install/remote-versioned-install'
import { createWslDistroHolder, type WslDistroHolder } from './wsl-distro-holder'
import { wslDistroHolderKey } from './wsl-distro-holder-record'
import { readWslDistroRegistryIdShared } from './wsl-distro-registry-id'
import type { WslHelixdHostTarget } from './wsl-helixd-host-target'
import {
  createWslHelixdHostTransport,
  type WslHelixdHostTransport
} from './wsl-helixd-host-transport'
import { readWslHelixdIncumbent, type WslHelixdIncumbent } from './wsl-helixd-incumbent'
import { adoptUnrecordedWslHelixd } from './wsl-helixd-instance-adoption'
import {
  admitWslHelixdLaunch,
  recordWslHelixdUpdateFailure,
  wslHelixdDeferralCode,
  wslHelixdDeferralFailure
} from './wsl-helixd-update-admission'

/** An update this app carries that the host may not take yet; the incumbent keeps serving. */
export type WslHelixdDeferredUpdate = WslHostDeferredUpdate

export type WslHelixdLaunch =
  | {
      outcome: 'ready'
      distro: string
      /** The Lxss registration GUID for the deployment record's `distroId`; null if unreadable. */
      distroId: string | null
      /** The loopback port helixd bound inside the distro (another one when the preferred was taken). */
      port: number
      fullVersion: string
      pid: number | null
      readiness: ServeReadiness
      holder: 'adopted' | 'spawned' | 'unverifiable'
      /** An helixd the record did not name (e.g. left by a failed Remove), now recorded. */
      adoptedInstance?: { version: string; pid: number }
      /** Set when `fullVersion` is the incumbent because the update must wait. */
      deferredUpdate?: WslHelixdDeferredUpdate
    }
  | ({ outcome: 'deferred'; distro: string } & WslHelixdDeferredUpdate)

export type WslHelixdDeployOptions = {
  /** The WSL environment's id; keys host-scoped state (wake dedupe). Defaults per distro. */
  environmentId?: string
  label?: string
  /** Defaults to a connect. */
  intent?: HelixdUpdateIntent
  signal?: AbortSignal
  /** Defaults to one created over `userData`; the app should pass its shared instance. */
  holder?: WslDistroHolder
  createTransport?: (target: WslHelixdHostTarget) => HelixdHostTransport & { dispose?(): void }
  readRegistryId?: (distro: string) => Promise<string | null>
  readIncumbent?: typeof readWslHelixdIncumbent
  /** This desktop's enrolled pairing, which the incumbent's terminal count authenticates with. */
  pairedOffer?: PairingOffer | null
  /** The helixd template to deploy from; defaults to the packaged one (the C10 lane swaps it). */
  templateDir?: string
}

/** Until the persisted deployment record (C7) assigns one, the environment is keyed per distro. */
export function defaultWslHelixdEnvironmentId(distro: string): string {
  return `wsl:${wslDistroHolderKey(distro)}`
}

/** WSL 1 runs no Linux kernel, so the pinned Node and its pty cannot run there. */
export function isWsl1KernelRelease(release: string): boolean {
  return /^\d+\.\d+\.\d+-\d+-Microsoft$/.test(release.trim())
}

export async function deployAndLaunchWslHelixd(
  distro: string,
  options: WslHelixdDeployOptions = {}
): Promise<WslHelixdLaunch> {
  const name = distro.trim()
  if (!name) {
    throw new Error('A WSL distro name is required')
  }
  const target: WslHelixdHostTarget = {
    kind: 'wsl',
    id: options.environmentId ?? defaultWslHelixdEnvironmentId(name),
    distro: name,
    label: options.label ?? name
  }
  const conn = (options.createTransport ?? defaultTransport)(target)
  try {
    return await launchOverTransport(name, target, conn, options)
  } finally {
    conn.dispose?.()
  }
}

async function launchOverTransport(
  name: string,
  target: WslHelixdHostTarget,
  conn: HelixdHostTransport,
  options: WslHelixdDeployOptions
): Promise<WslHelixdLaunch> {
  const { signal } = options
  const kernel = await execCommand(conn, 'uname -r', { signal })
  if (isWsl1KernelRelease(kernel)) {
    throw new HelixdHostUnsupportedError(
      `The WSL 1 distro ${name} isn’t supported by Helix’s server. ` +
        `Convert it with: wsl --set-version ${name} 2`
    )
  }
  // Acquire a holder before launch or WSL can idle-stop helixd's distro.
  const holder = options.holder ?? createWslDistroHolder({ userDataPath: userDataPath() })
  const held = await holder.ensureHeld(name)
  // Read GUID alongside deploy; failure leaves the record without one.
  const distroId = (options.readRegistryId ?? readWslDistroRegistryIdShared)(name).catch(() => null)
  let context = await resolveHelixdRemoteContext(target, conn, signal)
  const slot = managedHelixdSlot(context, HELIXD_MANAGED_REMOTE_PORT, signal)
  const recovery = await recoverInterruptedHelixdActivation(slot)
  if (recovery.outcome === 'pending' || recovery.outcome === 'refused') {
    throw new Error(recovery.reason)
  }
  if (recovery.outcome === 'recovered') {
    context = { ...context, activationRecord: await readHelixdActivationRecord(slot) }
  }
  // Adopt unrecorded helixd before deploy/wake or its instance lock blocks launch.
  const adoption = await adoptUnrecordedWslHelixd(slot, context.activationRecord)
  if (adoption.outcome === 'adopted') {
    context = { ...context, activationRecord: adoption.record }
  }
  const localHelixdDir = await materializeHelixdArtifact(context.serverTarget, {
    signal,
    trustVerificationRecord: true,
    ...(options.templateDir ? { templateDir: options.templateDir } : {})
  })
  const appVersion = getAppEnvironment().getVersion()
  const candidateVersion = readLocalFullVersion(localHelixdDir)
  const failureHost = { kind: 'wsl', id: target.id } as const
  const intent = options.intent ?? 'connect'
  const admit = (record: HelixdActivationRecord, admitIntent: HelixdUpdateIntent) =>
    admitWslHelixdLaunch(
      { slot, record, candidateVersion, appVersion, host: failureHost, intent: admitIntent },
      name,
      readyLaunch
    )
  const admitted = await admit(context.activationRecord, intent)
  if ('outcome' in admitted) {
    return admitted
  }
  context = { ...context, activationRecord: admitted }
  const incumbentVersion = context.activationRecord.active
  // Only version changes need incumbent census; same-version connects deploy as no-ops.
  const incumbent: WslHelixdIncumbent | null =
    incumbentVersion && incumbentVersion !== candidateVersion
      ? await (options.readIncumbent ?? readWslHelixdIncumbent)({
          context,
          slot,
          paired: options.pairedOffer ?? null
        })
      : null
  const deployed = await deployHelixd({
    ...slot,
    conn,
    localHelixdDir,
    target: context.serverTarget,
    ...managedHelixdDeployPolicy(context, appVersion, intent),
    ...(incumbent
      ? {
          census: incumbent.census,
          recountCensus: incumbent.recount,
          releaseIncumbentAdmission: incumbent.releaseAdmission
        }
      : {}),
    force: intent === 'force',
    appVersion,
    recordedNodeRuntimeProbe: true
  }).catch((error: unknown) => {
    if (!signal?.aborted) {
      recordWslHelixdUpdateFailure(failureHost, incumbentVersion, {
        code: 'helixd_update_failed',
        reason: errorMessage(error)
      })
    }
    throw error
  })
  if (deployed.outcome === 'installed-not-activated') {
    const failure = wslHelixdDeferralFailure(deployed)
    recordWslHelixdUpdateFailure(failureHost, incumbentVersion, failure)
    const restored = incumbentVersion && failure ? await readRestoredRecord(incumbentVersion) : null
    if (restored) {
      // After rollback proof, serve the restored incumbent on this connect too.
      const retried = await admit(restored, 'connect')
      if ('outcome' in retried) {
        return retried
      }
    }
    const deferredUpdate: WslHelixdDeferredUpdate = {
      candidateVersion: deployed.fullVersion,
      code: await wslHelixdDeferralCode(slot, deployed, appVersion),
      reason: deployed.reason,
      forceable:
        isForceableHelixdDeferral(deployed.code) ||
        deployed.code === HELIXD_ACTIVATION_POLICY_REFUSED_CODE
    }
    // Live-terminal deferrals keep the incumbent serving until Update/Force.
    if (
      incumbentVersion &&
      incumbent?.readiness &&
      isWaitingHelixdUpdateDeferral(deployed.code) &&
      // Another client may have activated since census; refuse stale incumbent assumptions.
      (await readHelixdActivationRecord(slot)).active === incumbentVersion
    ) {
      const serving = {
        fullVersion: incumbentVersion,
        readiness: incumbent.readiness
      }
      return { ...(await readyLaunch(serving)), deferredUpdate }
    }
    return { outcome: 'deferred', distro: name, ...deferredUpdate }
  }
  clearHelixdUpdateFailedThisLaunch(failureHost)
  if (deployed.outcome === 'already-active') {
    // A stopped distro ended the active slot with it.
    await wakeAlreadyActiveHelixd(slot)
  }
  const readiness = await probeManagedHelixdReadiness(
    context,
    localHelixdDir,
    deployed.fullVersion,
    signal
  )
  await pruneManagedHelixdVersions({
    slot,
    serverTarget: context.serverTarget,
    activeVersion: deployed.fullVersion,
    readiness
  })
  return readyLaunch({ fullVersion: deployed.fullVersion, readiness })

  /** The record only once the incumbent is back and no journal awaits recovery; else null. */
  async function readRestoredRecord(incumbent: string): Promise<HelixdActivationRecord | null> {
    // Unreadable transaction state proves no restoration; preserve the rejection.
    if (await readHelixdActivationTransaction(slot).catch(() => true)) {
      return null
    }
    const record = await readHelixdActivationRecord(slot).catch(() => null)
    return record?.active === incumbent ? record : null
  }

  async function readyLaunch(serving: {
    fullVersion: string
    readiness: ServeReadiness
  }): Promise<Extract<WslHelixdLaunch, { outcome: 'ready' }>> {
    const pidFile = joinRemotePath(
      context.host,
      managedHelixdInstallDir(context, serving.fullVersion),
      HELIXD_PID_FILENAME
    )
    const pid = Number.parseInt(
      await execCommand(conn, `cat ${quotePosixShell(pidFile)} 2>/dev/null || true`, { signal }),
      10
    )
    return {
      outcome: 'ready',
      distro: name,
      distroId: await distroId,
      port: helixdBoundPort(serving.readiness) ?? HELIXD_MANAGED_REMOTE_PORT,
      fullVersion: serving.fullVersion,
      pid: Number.isSafeInteger(pid) && pid > 0 ? pid : null,
      readiness: serving.readiness,
      holder: held.outcome,
      ...(adoption.outcome === 'adopted'
        ? { adoptedInstance: { version: adoption.version, pid: adoption.pid } }
        : {})
    }
  }
}

function defaultTransport(target: WslHelixdHostTarget): WslHelixdHostTransport {
  return createWslHelixdHostTransport({ target })
}

function userDataPath(): string {
  return getAppEnvironment().getPath('userData')
}
