/** Reject activation over state a newer host build may already have migrated. */
import { compareAppVersions } from '../../shared/app-version'
import type { HelixdActivationRecord } from '../managed-server/activation/helixd-activation-record'

export type HelixdHostVersionRefusal = 'host-newer'

export function refuseHelixdHostDowngrade(
  record: HelixdActivationRecord,
  candidateVersion: string,
  appVersion: string
): HelixdHostVersionRefusal | null {
  // Restarting the stopped build cannot downgrade state.
  if (record.active === null && record.previous === candidateVersion) {
    return null
  }
  // Older Stop records omit app version; refuse only proven newer hosts or they would be stranded.
  if (!record.activeAppVersion) {
    return null
  }
  return compareAppVersions(record.activeAppVersion, appVersion) > 0 ? 'host-newer' : null
}
