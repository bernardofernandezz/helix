import { isHelixSessionId, type HelixSessionId } from './helix-session-address'

/** A literal Helix session id for a test, checked by the same predicate production uses. */
export function testHelixSessionId(id: string): HelixSessionId {
  if (!isHelixSessionId(id)) {
    throw new Error(`Not an Helix session id: ${id}`)
  }
  return id
}
