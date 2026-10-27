import { isAgentSessionId } from './agent-session-record'
import { STRUCTURED_WORKER_HANDLE_PREFIX } from './structured-worker-handle'
import { HELIX_SESSION_ADDRESS_PREFIX } from './helix-session-address-prefix'

/** Helix-minted structured session identity (record id/HELIX_AGENT_SESSION_ID), never provider identity. Orchestration stores bare lineage-root ids after /clear,
 * not live replacement ids; derive mail spelling helix_session_id:<id> alongside run:/dispatch: addresses.
 * Resolve execution location from records. PTYs have no id today; never use pane keys because later agents inherit panes. */
export { HELIX_SESSION_ADDRESS_PREFIX }

declare const helixSessionIdBrand: unique symbol
declare const helixSessionAddressBrand: unique symbol

/** A bare Helix session id; only `isHelixSessionId` and `parseHelixSessionAddress` produce one. */
export type HelixSessionId = string & { readonly [helixSessionIdBrand]: true }
/** An `helix_session_id:<id>` mail address; only `formatHelixSessionAddress` produces one. */
export type HelixSessionAddress = string & { readonly [helixSessionAddressBrand]: true }

// Terminal handles (term_/structworker_) share the charset but are never durable session ids.
const TERMINAL_HANDLE_PREFIXES = ['term_', STRUCTURED_WORKER_HANDLE_PREFIX] as const

export function isHelixSessionId(id: string): id is HelixSessionId {
  return isAgentSessionId(id) && !TERMINAL_HANDLE_PREFIXES.some((prefix) => id.startsWith(prefix))
}

export function formatHelixSessionAddress(helixSessionId: HelixSessionId): HelixSessionAddress {
  const address = `${HELIX_SESSION_ADDRESS_PREFIX}${helixSessionId}`
  // Always true for a checked id; the check brands the address without a type assertion.
  if (!isHelixSessionAddress(address)) {
    throw new Error(`Not an Helix session id: ${helixSessionId}`)
  }
  return address
}

/** The bare Helix session id of an `helix_session_id:<id>` address; anything else reads as null. */
export function parseHelixSessionAddress(
  address: string | null | undefined
): HelixSessionId | null {
  if (!address?.startsWith(HELIX_SESSION_ADDRESS_PREFIX)) {
    return null
  }
  const id = address.slice(HELIX_SESSION_ADDRESS_PREFIX.length)
  return isHelixSessionId(id) ? id : null
}

function isHelixSessionAddress(address: string): address is HelixSessionAddress {
  return parseHelixSessionAddress(address) !== null
}
