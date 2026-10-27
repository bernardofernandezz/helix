export const HELIXD_PAIRING_REPAIR_FAILED_CODE = 'helixd_pairing_repair_failed'

export class HelixdManagedPairingRepairFailedError extends Error {
  readonly code = HELIXD_PAIRING_REPAIR_FAILED_CODE
  constructor(reason: string) {
    super(
      `${HELIXD_PAIRING_REPAIR_FAILED_CODE}: the Helix server on this host no longer accepts this ` +
        `computer, and Helix couldn't pair with it again over SSH: ${reason}. Nothing on the host ` +
        `was stopped; its terminals can't be verified until Helix pairs again. Connect again to retry.`
    )
    this.name = 'HelixdManagedPairingRepairFailedError'
  }
}
