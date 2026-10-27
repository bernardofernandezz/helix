import type { RuntimeWorkspaceCatalog } from './workspace-catalog'
import type { HelixRuntimeWithRefreshPtyWorktreeRecordsFromController } from '../terminal/lifecycle/pty-worktree-refresh'
import type { RuntimeAccountController } from '../runtime-account-controller'
import type { HelixRuntimeWithPruneMobileSessionTabGroupLayout } from '../session-lifecycle/projection/prune-mobile-session-tab-group-layout'
import type { HelixRuntimeWithGetStructuredAgentSessionCreateSupport } from '../session-tabs/structured-session-create-support'
import type { HelixRuntimeWithGetPtyRecordForPaneKey } from '../orchestration/terminal-pane-mail-routing'
import { HelixRuntimeWithStartTuiIdleVisibleReadProbe } from '../terminal/wait/terminal-wait-visible-probe'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'

export abstract class HelixRuntimeWithWorktreePsDependencies extends HelixRuntimeWithStartTuiIdleVisibleReadProbe {
  protected abstract listResolvedWorktreeSnapshot(
    ...args: Parameters<RuntimeWorkspaceCatalog['listResolvedWorktreeSnapshot']>
  ): ReturnType<RuntimeWorkspaceCatalog['listResolvedWorktreeSnapshot']>
  protected abstract refreshPtyWorktreeRecordsFromController(
    ...args: Parameters<
      HelixRuntimeWithRefreshPtyWorktreeRecordsFromController['refreshPtyWorktreeRecordsFromController']
    >
  ): ReturnType<
    HelixRuntimeWithRefreshPtyWorktreeRecordsFromController['refreshPtyWorktreeRecordsFromController']
  >
  abstract notifyFolderWorkspaceChanged(): void
  abstract notifyBranchRenamed(repoId: string): void
  abstract notifyWorktreeFolderRenamed(
    repoId: string,
    oldWorktreeId: string,
    newWorktreeId: string
  ): void
  declare getCommitMessageAgentEnvironmentResolvers: RuntimeAccountController['getCommitMessageAgentEnvironment']
  abstract refreshStructuredConversationTabTitle(
    ...args: Parameters<
      HelixRuntimeWithPruneMobileSessionTabGroupLayout['refreshStructuredConversationTabTitle']
    >
  ): ReturnType<
    HelixRuntimeWithPruneMobileSessionTabGroupLayout['refreshStructuredConversationTabTitle']
  >
  abstract resolveStructuredAgentAccountHome(
    ...args: Parameters<
      HelixRuntimeWithGetStructuredAgentSessionCreateSupport['resolveStructuredAgentAccountHome']
    >
  ): ReturnType<
    HelixRuntimeWithGetStructuredAgentSessionCreateSupport['resolveStructuredAgentAccountHome']
  >
  abstract onStructuredSessionStatusForMail(
    ...args: Parameters<HelixRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionStatusForMail']>
  ): ReturnType<HelixRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionStatusForMail']>
  protected abstract assertStructuredChatAcquireAdmissible(
    record: AgentSessionRecord
  ): Promise<void>
  abstract isChatWorkerErrorEscalationEnabled(): boolean
  abstract onStructuredSessionTabHidden(
    ...args: Parameters<HelixRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionTabHidden']>
  ): ReturnType<HelixRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionTabHidden']>
}
