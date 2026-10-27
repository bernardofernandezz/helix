import { wakeStoppedManagedHelixd } from '../managed-server/lifecycle/helixd-managed-wake'
import type { HelixdSlotOptions } from './helixd-recovery-slot'

/** Already-active deploys launch nothing; wake that slot only on proven exit, including after reboot. Return whether it was started. */
export async function wakeAlreadyActiveHelixd(options: HelixdSlotOptions): Promise<boolean> {
  const wake = await wakeStoppedManagedHelixd(options)
  if (wake.outcome === 'recovery-refused') {
    throw new Error(wake.reason)
  }
  return wake.outcome === 'started'
}
