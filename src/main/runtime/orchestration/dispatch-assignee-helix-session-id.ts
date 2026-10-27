import {
  parseHelixSessionAddress,
  type HelixSessionId
} from '../../../shared/helix-session-address'
import { structuredWorkerHelixSessionIdForIncarnation } from '../structured-worker-identity'
import { canonicalHelixSessionId } from './canonical-helix-session-id'

/** Resolve structured incarnations or chat addresses to bare session ids; PTYs have none. */
export function dispatchAssigneeHelixSessionId(assignee: {
  handle: string
  processIncarnation: string | null | undefined
}): HelixSessionId | null {
  const helixSessionId =
    structuredWorkerHelixSessionIdForIncarnation(assignee.processIncarnation) ??
    parseHelixSessionAddress(assignee.handle)
  return helixSessionId === null ? null : canonicalHelixSessionId(helixSessionId)
}
