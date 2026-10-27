import type { ActivityTerminalPortalTarget } from './activity/activity-terminal-portal'
import TerminalPaneOverlayLayer from './terminal-pane/TerminalPaneOverlayLayer'
import { RetainedBrowserPaneOverlayLayer } from './browser-pane/assemble-chrome/BrowserPaneOverlayLayer'
import StructuredAgentSessionPaneOverlayLayer from './native-chat/StructuredAgentSessionPaneOverlayLayer'
import AiVaultSessionDropLayer from './tab-group/AiVaultSessionDropLayer'

/** Share retained pane hosts across group-tree hosts so retention, parking and browser paint have one lifecycle owner. */
export function WorkspacePaneOverlayLayers({
  worktreeId,
  worktreePath,
  isVisible,
  shouldMeasureHiddenWorktree,
  shouldColdParkTerminalPanes,
  isForceParked,
  activityTerminalPortals,
  backgroundMountTabIds,
  activationDeferredMountTabIds,
  mountRetainedBrowserOverlay,
  ownsNativeChatToggleShortcut = true
}: {
  worktreeId: string
  worktreePath: string
  isVisible: boolean
  shouldMeasureHiddenWorktree: boolean
  shouldColdParkTerminalPanes: boolean
  isForceParked: boolean
  activityTerminalPortals: ActivityTerminalPortalTarget[]
  backgroundMountTabIds: ReadonlySet<string> | null
  activationDeferredMountTabIds: ReadonlySet<string> | null
  mountRetainedBrowserOverlay: boolean
  /** Floating overlays leave the toggle chord to the active workspace; duplicate listeners would both toggle. */
  ownsNativeChatToggleShortcut?: boolean
}): React.JSX.Element {
  return (
    <>
      <TerminalPaneOverlayLayer
        worktreeId={worktreeId}
        worktreePath={worktreePath}
        isWorktreeActive={isVisible}
        coldParkTerminalPanes={shouldColdParkTerminalPanes}
        isForceParked={isForceParked}
        shouldMeasureHiddenWorktree={shouldMeasureHiddenWorktree}
        activityTerminalPortals={activityTerminalPortals}
        backgroundMountTabIds={backgroundMountTabIds}
        activationDeferredMountTabIds={activationDeferredMountTabIds}
        ownsNativeChatToggleShortcut={ownsNativeChatToggleShortcut}
      />
      <RetainedBrowserPaneOverlayLayer
        worktreeId={worktreeId}
        isWorktreeActive={isVisible}
        mountEligible={mountRetainedBrowserOverlay}
      />
      <StructuredAgentSessionPaneOverlayLayer
        worktreeId={worktreeId}
        isWorktreeActive={isVisible}
      />
      <AiVaultSessionDropLayer worktreeId={worktreeId} enabled={isVisible} />
    </>
  )
}
