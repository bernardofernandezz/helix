import type { HelixPushPayload } from './push-payload'

export type NativeDismissal = {
  remember(payload: HelixPushPayload): Promise<void>
  wasDismissed(payload: HelixPushPayload): Promise<boolean>
}
// Android and web use JavaScript storage; iOS requires the native ledger.
export const nativePushDismissal: NativeDismissal | null = null
