// Derive Helix-stop cuts from the journal for Continue; never store them. Host rechecks under the session lock before sending.

import {
  readAgentSessionHelixStop,
  type AgentSessionHelixStopCause
} from '../agent-session-helix-stop'
import { isRootAgentJournalItem } from '../agent-session-journal-producer'
import type { AgentJournalRenderItem, AgentJournalSubmission } from '../agent-session-journal-types'
import { STALE_SESSION_ROW_PREFIX } from '../agent-session-stop-row-identity'
import { readAgentJournalTurn, readAgentJournalTurnOutcome } from '../agent-session-turn-record'
import { agentTurnVerdict, type AgentTurnOutcome } from '../agent-turn-outcome'
import { structuredAgentSessionCommandTurnItemIds } from '../structured-agent-session-command-entry'
import { isStructuredAgentSessionNonRequestRow } from '../structured-agent-session-latest-request'

// Dedupe shutdown rows by stopped child; preserve the legacy prefix so older clients add no duplicate notice.
export function helixShutdownRowClientMessageId(
  sessionId: string,
  fence: number,
  generation: string
): string {
  return `${STALE_SESSION_ROW_PREFIX}${sessionId}:shutdown-${fence}-${generation}`
}

export function helixStopCauseOfRow(
  item: AgentJournalRenderItem
): AgentSessionHelixStopCause | null {
  return item.body.kind === 'status'
    ? (readAgentSessionHelixStop(item.body.helixStop)?.cause ?? null)
    : null
}

export type NativeChatHelixStopCut = {
  turnItemId: string
  cause: AgentSessionHelixStopCause
}

/** Latest root turn only if no later request or in-flight send exists; steers/conversation commands do not count as new requests. */
export function latestNativeChatTurnSinceRequest(
  items: readonly AgentJournalRenderItem[],
  submissions: readonly Pick<AgentJournalSubmission, 'dispatchState'>[]
): { turnItem: AgentJournalRenderItem; verdict: AgentTurnOutcome | null } | null {
  if (submissions.some((submission) => submission.dispatchState === 'pending')) {
    return null
  }
  const commandTurns = structuredAgentSessionCommandTurnItemIds(items)
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!
    if (
      !isRootAgentJournalItem(item) ||
      isStructuredAgentSessionNonRequestRow(item, commandTurns)
    ) {
      continue
    }
    if (item.body.kind === 'message' && item.body.role === 'user') {
      return null
    }
    const turn = readAgentJournalTurn(item.body)
    if (turn) {
      return {
        turnItem: item,
        verdict: agentTurnVerdict({ state: turn.state, outcome: readAgentJournalTurnOutcome(turn) })
      }
    }
  }
  return null
}

export function findInNativeChatTurn<T>(
  items: readonly AgentJournalRenderItem[],
  turnItemId: string,
  read: (item: AgentJournalRenderItem) => T | null
): T | null {
  for (const item of items) {
    const inTurn = item.turnScope?.kind === 'turn' && item.turnScope.turnItemId === turnItemId
    const found = inTurn ? read(item) : null
    if (found !== null) {
      return found
    }
  }
  return null
}

export function latestNativeChatHelixStopCut(
  items: readonly AgentJournalRenderItem[],
  submissions: readonly Pick<AgentJournalSubmission, 'dispatchState'>[]
): NativeChatHelixStopCut | null {
  const latest = latestNativeChatTurnSinceRequest(items, submissions)
  if (!latest || latest.verdict !== 'interruption') {
    return null
  }
  const turnItemId = latest.turnItem.itemId
  const cause = findInNativeChatTurn(items, turnItemId, helixStopCauseOfRow)
  return cause ? { turnItemId, cause } : null
}
