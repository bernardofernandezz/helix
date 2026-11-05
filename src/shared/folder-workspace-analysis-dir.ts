import { joinSearchRoot } from './text-search-paths'
import { slugifyForWorkspaceName } from './workspace-name'

export const ANALYSES_DIR = 'analyses'

// Persisted meta can be written by other clients; only accept what analysisDirFor produces.
const ANALYSIS_DIR_PATTERN = /^analyses\/[a-z0-9_][a-z0-9._-]*$/

export function analysisDirFor(name: string, attempt: number): string {
  const slug = slugifyForWorkspaceName(name) || 'analysis'
  return `${ANALYSES_DIR}/${attempt > 1 ? `${slug}-${attempt}` : slug}`
}

/** Root and pre-analysis workspaces share the project folder; new ones get their own subfolder. */
export function folderWorkspacePath(repoPath: string, analysisDir: string | undefined): string {
  return analysisDir && ANALYSIS_DIR_PATTERN.test(analysisDir)
    ? joinSearchRoot(repoPath, analysisDir)
    : repoPath
}
