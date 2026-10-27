// Only refusals sealed by the pinned key may trigger repair; foreign servers fail identity checks.
import type { KnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import { pairingRevisionOf, type ManagedHelixdPairingGate } from './helixd-managed-pairing-repair'
import { HelixdManagedPairingRejectedError } from './helixd-managed-tunnel-identity'

export type ManagedHelixdPairingRecovery = {
  resolve: (environmentId: string) => KnownRuntimeEnvironment
  repairs: ManagedHelixdPairingGate
  ensure: (environment: KnownRuntimeEnvironment) => Promise<void>
}

/** Check cached refusal before building; permit one repair and rebuild on a refused pairing. */
export async function buildWithPairingRepair(
  recovery: ManagedHelixdPairingRecovery,
  environmentId: string,
  build: (environment: KnownRuntimeEnvironment) => Promise<void>
): Promise<'built' | 'repaired'> {
  const refused = recovery.resolve(environmentId)
  const epoch = recovery.repairs.resetEpoch(environmentId)
  const standing = recovery.repairs.standingFailure(environmentId, pairingRevisionOf(refused))
  if (standing) {
    throw standing
  }
  try {
    await build(refused)
    return 'built'
  } catch (error) {
    if (!(error instanceof HelixdManagedPairingRejectedError)) {
      throw error
    }
    console.warn('[managed-helixd] The Helix server refused this desktop; pairing again:', error)
  }
  // Revision matching joins already-completed repairs instead of repeating host work.
  const repaired = await recovery.repairs.repair(environmentId, pairingRevisionOf(refused))
  try {
    await recovery.ensure(repaired)
  } catch (error) {
    throw error instanceof HelixdManagedPairingRejectedError
      ? recovery.repairs.recordRefusedAfterRepair(environmentId, pairingRevisionOf(repaired), epoch)
      : error
  }
  return 'repaired'
}
