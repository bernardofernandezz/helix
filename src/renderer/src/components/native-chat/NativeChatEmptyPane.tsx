import { structuredAgentLabel } from '@/lib/structured-agent-session-launch-label'
import type { AgentType } from '../../../../shared/agent-status-types'
import {
  appendToNativeChatComposerDraft,
  structuredAgentSessionDraftScopeKey
} from './native-chat-composer-draft-store'
import { nativeChatResearchSuggestions } from './native-chat-research-suggestions'
import { NativeChatEmptyState } from './NativeChatEmptyState'
import { NativeChatInstallHero } from './NativeChatInstallHero'
import type { NativeChatInstallSlotState } from './NativeChatInstallSlot'

export function NativeChatEmptyPane(props: {
  slot: NativeChatInstallSlotState
  agent: AgentType
  /** Structured session id; suggestions land in its composer draft. */
  session: string
}): React.JSX.Element {
  const { slot, agent, session } = props
  return slot.kind === 'install' ? (
    <NativeChatInstallHero slot={slot} agentLabel={structuredAgentLabel(agent)} />
  ) : (
    <NativeChatEmptyState
      kind="empty"
      agent={agent}
      suggestions={nativeChatResearchSuggestions()}
      onSuggestion={(prompt) =>
        appendToNativeChatComposerDraft(structuredAgentSessionDraftScopeKey(session), {
          text: prompt
        })
      }
    />
  )
}
