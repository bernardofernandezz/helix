/** Reuse SSH update admission: keep newer, rolled-back or launch-rejected incumbents serving; fenced activation replans before committing. */
import {
  HELIXD_HOST_NEWER_DEFERRAL_CODE,
  type WslHostDeferredUpdate
} from '../../shared/wsl-host-types'
import { refuseHelixdHostDowngrade } from '../ssh/helixd-host-version-admission'
import type { ServeReadiness } from '../server/serve-readiness'
import type { HelixdActivationRecord } from '../managed-server/activation/helixd-activation-record'
import { readHelixdActivationRecord } from '../managed-server/activation/helixd-activation-record-store'
import { isWaitingHelixdUpdateDeferral } from '../managed-server/lifecycle/helixd-managed-auto-update'
import {
  helixdUpdateSkipRefusal,
  planHelixdUpdateForIntent,
  type ManagedHelixdAutoUpdatePlan,
  type HelixdUpdateIntent
} from '../managed-server/lifecycle/helixd-managed-update-decision'
import {
  helixdUpdateFailureThisLaunch,
  recordHelixdUpdateFailedThisLaunch,
  type HelixdUpdateFailure,
  type HelixdUpdateFailureHost
} from '../managed-server/lifecycle/helixd-managed-update-failure-memory'
import { HELIXD_ACTIVATION_POLICY_REFUSED_CODE } from '../ssh/helixd-installed-activation'
import type { HelixdSlotOptions } from '../ssh/helixd-recovery-slot'
import { adoptRunningHelixdVersion } from '../ssh/helixd-running-version-adoption'
import type { WslHelixdLaunch } from './wsl-helixd-deploy'

type WslHelixdReadyLaunch = Extract<WslHelixdLaunch, { outcome: 'ready' }>

export type WslHelixdUpdateAdmission =
  | {
      action: 'serve'
      version: string
      readiness: ServeReadiness
      deferredUpdate: WslHostDeferredUpdate | null
    }
  /** Another run holds the host fence; a later connect adopts or deploys. */
  | { action: 'defer'; deferredUpdate: WslHostDeferredUpdate }
  /** Deploy this app's build on this record. */
  | { action: 'deploy'; record: HelixdActivationRecord }

export async function admitWslHelixdUpdate(args: {
  slot: HelixdSlotOptions
  record: HelixdActivationRecord
  candidateVersion: string
  appVersion: string
  host: HelixdUpdateFailureHost
  intent: HelixdUpdateIntent
}): Promise<WslHelixdUpdateAdmission> {
  const { record, candidateVersion, appVersion } = args
  if (!record.active) {
    return { action: 'deploy', record }
  }
  const failure = helixdUpdateFailureThisLaunch(args.host)
  const plan = planHelixdUpdateForIntent(args.intent, {
    record,
    candidateVersion,
    appVersion,
    failedBefore: failure !== null
  })
  if (plan.action !== 'skip' || plan.reason === 'current') {
    return { action: 'deploy', record }
  }
  const adopted = await adoptRunningHelixdVersion(args.slot, record, candidateVersion)
  if (!adopted) {
    // Nothing active any more: deploy on the record the wake read; its fenced admission re-plans.
    return { action: 'deploy', record: await readHelixdActivationRecord(args.slot) }
  }
  if ('outcome' in adopted) {
    const { candidateVersion: version, code, reason, forceable } = adopted
    return {
      action: 'defer',
      deferredUpdate: { candidateVersion: version, code, reason, forceable: forceable === true }
    }
  }
  return {
    action: 'serve',
    version: adopted.version,
    readiness: adopted.readiness,
    deferredUpdate:
      adopted.version === candidateVersion
        ? null
        : skippedUpdateHint(plan, failure, record, candidateVersion, appVersion)
  }
}

/** The launch an admission ends in, or the record to deploy on. */
export async function admitWslHelixdLaunch(
  args: Parameters<typeof admitWslHelixdUpdate>[0],
  distro: string,
  readyLaunch: (serving: {
    fullVersion: string
    readiness: ServeReadiness
  }) => Promise<WslHelixdReadyLaunch>
): Promise<WslHelixdLaunch | HelixdActivationRecord> {
  const admission = await admitWslHelixdUpdate(args)
  if (admission.action === 'deploy') {
    return admission.record
  }
  if (admission.action === 'defer') {
    return { outcome: 'deferred', distro, ...admission.deferredUpdate }
  }
  const ready = await readyLaunch({
    fullVersion: admission.version,
    readiness: admission.readiness
  })
  return admission.deferredUpdate ? { ...ready, deferredUpdate: admission.deferredUpdate } : ready
}

/** Offer Update/Force for retriable host deferrals; newer hosts get no hint because Update cannot change that refusal. */
function skippedUpdateHint(
  plan: ManagedHelixdAutoUpdatePlan,
  failure: HelixdUpdateFailure | null,
  record: HelixdActivationRecord,
  candidateVersion: string,
  appVersion: string
): WslHostDeferredUpdate | null {
  if (plan.action !== 'skip') {
    return null
  }
  if (plan.reason === 'failed-before' && failure) {
    return { candidateVersion, ...failure, forceable: true }
  }
  const refusal =
    plan.reason === 'rolled-back'
      ? helixdUpdateSkipRefusal(plan, record, candidateVersion, appVersion)
      : null
  return refusal
    ? {
        candidateVersion,
        code: HELIXD_ACTIVATION_POLICY_REFUSED_CODE,
        reason: refusal,
        forceable: true
      }
    : null
}

/** Do not retry rejected/thrown incumbent updates this launch, matching SSH. Waits/policy refusals never attempted activation and record no failure. */
export function recordWslHelixdUpdateFailure(
  host: HelixdUpdateFailureHost,
  incumbentVersion: string | null,
  failure: HelixdUpdateFailure | null
): void {
  if (incumbentVersion && failure) {
    recordHelixdUpdateFailedThisLaunch(host, failure)
  }
}

export function wslHelixdDeferralFailure(deployed: {
  code: string
  reason: string
}): HelixdUpdateFailure | null {
  return isWaitingHelixdUpdateDeferral(deployed.code) ||
    deployed.code === HELIXD_ACTIVATION_POLICY_REFUSED_CODE
    ? null
    : { code: deployed.code, reason: deployed.reason }
}

/** A policy refusal over a host a newer Helix runs gets its own code: an Update cannot pass it. */
export async function wslHelixdDeferralCode(
  slot: HelixdSlotOptions,
  deployed: { code: string; fullVersion: string },
  appVersion: string
): Promise<string> {
  if (deployed.code !== HELIXD_ACTIVATION_POLICY_REFUSED_CODE) {
    return deployed.code
  }
  const record = await readHelixdActivationRecord(slot).catch(() => null)
  return record && refuseHelixdHostDowngrade(record, deployed.fullVersion, appVersion)
    ? HELIXD_HOST_NEWER_DEFERRAL_CODE
    : deployed.code
}
