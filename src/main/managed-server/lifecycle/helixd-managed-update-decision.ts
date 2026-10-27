import { compareAppVersions, isValidAppVersion } from '../../../shared/app-version'
import type { HelixdActivationRecord } from '../activation/helixd-activation-record'
import {
  refuseHelixdHostDowngrade,
  type HelixdHostVersionRefusal
} from '../../ssh/helixd-host-version-admission'

export type ManagedHelixdAutoUpdateSkip =
  | 'current'
  | 'no-template'
  | 'rolled-back'
  | 'failed-before'
  | 'migrating'
  | HelixdHostVersionRefusal

/** Connect honors all skips; Update retries local failures/rollbacks; Force also lifts version skips. */
export type HelixdUpdateIntent = 'connect' | 'update' | 'force'

export type ManagedHelixdAutoUpdatePlan =
  | { action: 'update' }
  | { action: 'skip'; reason: ManagedHelixdAutoUpdateSkip }

export function planManagedHelixdAutoUpdate(input: {
  record: HelixdActivationRecord
  candidateVersion: string | null
  appVersion: string
  failedBefore: boolean
}): ManagedHelixdAutoUpdatePlan {
  const { record, candidateVersion } = input
  if (!candidateVersion) {
    return { action: 'skip', reason: 'no-template' }
  }
  if (record.active === candidateVersion) {
    return { action: 'skip', reason: 'current' }
  }
  if (record.rolledBackFrom === candidateVersion) {
    return { action: 'skip', reason: 'rolled-back' }
  }
  const refusal = refuseHelixdHostDowngrade(record, candidateVersion, input.appVersion)
  if (refusal) {
    return { action: 'skip', reason: refusal }
  }
  // A stopped host has no serving fallback; retry even after a prior failed attempt.
  if (record.active === null && record.previous !== null) {
    return { action: 'update' }
  }
  return input.failedBefore ? { action: 'skip', reason: 'failed-before' } : { action: 'update' }
}

export function planHelixdUpdateForIntent(
  intent: HelixdUpdateIntent,
  input: Parameters<typeof planManagedHelixdAutoUpdate>[0]
): ManagedHelixdAutoUpdatePlan {
  if (intent === 'force') {
    return { action: 'update' }
  }
  if (intent === 'connect') {
    return planManagedHelixdAutoUpdate(input)
  }
  const { rolledBackFrom: _retried, ...record } = input.record
  return planManagedHelixdAutoUpdate({ ...input, record, failedBefore: false })
}

export function admitHelixdRecordForIntent(
  intent: HelixdUpdateIntent,
  appVersion: string
): (record: HelixdActivationRecord, candidateVersion: string) => string | null {
  return (record, candidateVersion) =>
    helixdUpdateSkipRefusal(
      planHelixdUpdateForIntent(intent, {
        record,
        candidateVersion,
        appVersion,
        failedBefore: false
      }),
      record,
      candidateVersion,
      appVersion
    )
}

export function helixdUpdateSkipRefusal(
  plan: ManagedHelixdAutoUpdatePlan,
  record: HelixdActivationRecord,
  candidateVersion: string,
  appVersion: string
): string | null {
  if (plan.action !== 'skip' || plan.reason === 'current') {
    return null
  }
  return plan.reason === 'rolled-back'
    ? `This host's server rolled back from ${candidateVersion}, so a connect does not activate ` +
        'it again; choose Update or Force to retry it.'
    : `Helix ${record.activeAppVersion} last ran this host's server, newer than this ` +
        `Helix (${appVersion}). Update Helix to start it.`
}

/** Content hashes cannot order updates: compare Helix versions, or for legacy hosts offer only this desktop's previously deferred build. */
export function availableManagedHelixdUpdate(input: {
  record: HelixdActivationRecord
  candidateVersion: string | null
  appVersion: string
  /** The build this desktop's last Update or connect deferred on this host. */
  deferredCandidateVersion: string | null
}): string | null {
  const { record, candidateVersion, appVersion } = input
  const hostAppVersion = record.activeAppVersion
  if (!candidateVersion || record.active === null || !isValidAppVersion(appVersion)) {
    return null
  }
  const ordered = hostAppVersion
    ? isValidAppVersion(hostAppVersion) && compareAppVersions(appVersion, hostAppVersion) >= 0
    : input.deferredCandidateVersion === candidateVersion
  if (!ordered) {
    return null
  }
  // Connect rules: a build the user rolled back from is not advertised again.
  const plan = planManagedHelixdAutoUpdate({
    record,
    candidateVersion,
    appVersion,
    failedBefore: false
  })
  return plan.action === 'update' ? candidateVersion : null
}
