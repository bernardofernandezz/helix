import type { ServeReadiness } from '../server/serve-readiness'
import type { HelixdManagedStopContext } from '../../shared/helixd-stop-request'

export type HelixdOptions = {
  port?: number
  json?: boolean
  noPairing?: boolean
  pairingAddress?: string
  /** Request a mobile-scoped pairing offer and terminal QR. */
  mobilePairing?: boolean
  grantDesktopControl?: boolean
  /** Print only the ephemeral-VM recipe line. */
  recipeJson?: boolean
  projectRoot?: string
  bind?: string
  /** Slots have no browser client; helix serve supplies the installed app client. */
  webClientRoot?: string
}

export type HelixdHandle = {
  readiness: ServeReadiness
  managedStop: HelixdManagedStopContext
  stop(): Promise<void>
}
