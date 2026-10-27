/** Pair with an already-running foreign build before considering update; an unpaired first deploy cannot census its terminals. */
import type { ServeReadiness } from '../server/serve-readiness'
import type { HelixdManagedDeferral } from '../../shared/helixd-managed-runtime'
import { helixdActivationFenceRefusal } from '../managed-server/activation/helixd-activation-fence-hold'
import { HelixdActiveReadinessError, probeActiveHelixdReadiness } from './helixd-active-readiness'
import type { HelixdActivationRecord } from '../managed-server/activation/helixd-activation-record'
import { readHelixdActivationRecord } from '../managed-server/activation/helixd-activation-record-store'
import { wakeStoppedManagedHelixd } from '../managed-server/lifecycle/helixd-managed-wake'
import { resolveHelixdSlotIdentity, type HelixdSlotOptions } from './helixd-recovery-slot'

export type HelixdRunningAdoption = {
  version: string
  readiness: ServeReadiness
  /** Reads the adopted slot's readiness again, e.g. after it rebinds its port. */
  reprobe: () => Promise<ServeReadiness>
}

/** No foreign activation returns null for normal deploy. A held peer fence defers: deploying without pairing would only fail census. */
export async function adoptRunningHelixdVersion(
  slot: HelixdSlotOptions,
  record: HelixdActivationRecord,
  localVersion: string,
  retryClearedFence = true
): Promise<HelixdRunningAdoption | HelixdManagedDeferral | null> {
  if (!record.active || record.active === localVersion) {
    return null
  }
  // Wake only on proven server exit; idle stops leave daemon terminals alive.
  const wake = await wakeStoppedManagedHelixd(slot)
  switch (wake.outcome) {
    // Another desktop stopped it meanwhile; the deploy's own gates decide.
    case 'not-activated':
      return null
    case 'fenced': {
      // E.g. another desktop starting it after a reboot; a later connect pairs with it.
      const { cleared, ...refusal } = await helixdActivationFenceRefusal(slot, 'server start')
      if (cleared && retryClearedFence) {
        return adoptRunningHelixdVersion(slot, record, localVersion, false)
      }
      return { outcome: 'deferred', candidateVersion: localVersion, ...refusal, forceable: false }
    }
    case 'unverifiable':
      throw new HelixdActiveReadinessError(
        'unverifiable',
        `Helix ${record.active} runs this host's server, but its process state is unverifiable, ` +
          'so it was left as it is. Try connecting again.'
      )
    case 'recovery-refused':
      throw new Error(wake.reason)
    case 'serving':
    case 'started':
      break
  }
  // Re-read activation because wake follows peer changes to the current record.
  const active = (await readHelixdActivationRecord(slot)).active
  if (!active || active === localVersion) {
    return null
  }
  const identity = await resolveHelixdSlotIdentity(slot, active)
  const reprobe = () =>
    probeActiveHelixdReadiness(
      { ...slot, remoteInstallDir: identity.remoteDir },
      { buildHash: identity.buildHash, fullVersion: identity.version }
    )
  return { version: active, readiness: await reprobe(), reprobe }
}
