import { mkdir } from 'node:fs/promises'
import type { Repo } from '../shared/repo-types'
import {
  ANALYSES_DIR,
  analysisDirFor,
  folderWorkspacePath
} from '../shared/folder-workspace-analysis-dir'
import { joinSearchRoot } from '../shared/text-search-paths'
import { resolveWorktreeCreateRoute } from './worktree-create-execution-host-route'

/** Creates `analyses/<slug>[-n]` so parallel agents in one research project never share a cwd. */
export async function createAnalysisDir(repo: Repo, name: string): Promise<string | undefined> {
  // ponytail: non-local repos keep the shared project root; mkdir via the host runtime when remote isolation matters.
  if (resolveWorktreeCreateRoute(repo).kind !== 'local') {
    return undefined
  }
  await mkdir(joinSearchRoot(repo.path, ANALYSES_DIR), { recursive: true })
  for (let attempt = 1; ; attempt++) {
    const analysisDir = analysisDirFor(name, attempt)
    try {
      // Non-recursive mkdir fails with EEXIST, which is the collision check.
      await mkdir(folderWorkspacePath(repo.path, analysisDir))
      return analysisDir
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw error
      }
    }
  }
}
