import { HelixRuntimeWithWorkspaceActivityFacts } from './helix-runtime-workspace-activity-facts'
import {
  buildWorkspaceReviewFacts,
  type WorkspaceReviewFactsSnapshot
} from '../../../shared/sidebar-list/workspace-review-facts'

/** Read host-persisted PR facts on demand; windows save cache updates within a second, while helixd uses its existing profile. */
export abstract class HelixRuntimeWithWorkspaceReviewFacts extends HelixRuntimeWithWorkspaceActivityFacts {
  async getWorkspaceReviewFacts(): Promise<WorkspaceReviewFactsSnapshot> {
    if (!this.store) {
      return { facts: {} }
    }
    const { worktrees } = await this.listResolvedWorktreeSnapshot()
    return {
      facts: buildWorkspaceReviewFacts(
        worktrees,
        this.store.getRepos(),
        this.store.getGitHubCache().pr
      )
    }
  }
}
