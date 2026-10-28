import { defineFixture } from '../../component-fixtures/component-fixture'
import { NativeChatEmptyState } from './NativeChatEmptyState'
import { nativeChatAppearanceStyle } from './native-chat-appearance-style'
import { nativeChatResearchSuggestions } from './native-chat-research-suggestions'

export const researchSuggestions = defineFixture({
  width: 640,
  render: () => (
    <div
      className="native-chat-appearance h-[360px] bg-chat-canvas"
      style={nativeChatAppearanceStyle({})}
    >
      <NativeChatEmptyState
        kind="empty"
        agent="claude"
        suggestions={nativeChatResearchSuggestions()}
        onSuggestion={() => {}}
      />
    </div>
  )
})
