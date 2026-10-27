import type { HelixdManagedDeferral } from '../../../shared/helixd-managed-runtime'
import { compareAppVersions } from '../../../shared/app-version'

type RecordedDeferral = HelixdManagedDeferral & { deferredAt: string }

const deferrals = new Map<string, RecordedDeferral>()

export function recordManagedHelixdUpdateDeferral(
  environmentId: string,
  deferral: HelixdManagedDeferral,
  now = new Date()
): void {
  deferrals.set(environmentId, { ...deferral, deferredAt: now.toISOString() })
}

export function clearManagedHelixdUpdateDeferral(environmentId: string): void {
  deferrals.delete(environmentId)
}

function readManagedHelixdUpdateDeferral(environmentId: string): RecordedDeferral | null {
  return deferrals.get(environmentId) ?? null
}

/** Forget deferrals resolved by another desktop activating the candidate or a newer release. */
export function currentManagedHelixdUpdateDeferral(
  environmentId: string,
  activeVersion: string | null
): RecordedDeferral | null {
  const deferral = readManagedHelixdUpdateDeferral(environmentId)
  if (
    deferral &&
    activeVersion &&
    (activeVersion === deferral.candidateVersion ||
      compareAppVersions(activeVersion, deferral.candidateVersion) > 0)
  ) {
    clearManagedHelixdUpdateDeferral(environmentId)
    return null
  }
  return deferral
}
