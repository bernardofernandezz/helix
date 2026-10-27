import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { ResearchProjectSetupResult } from '../../shared/research-project-types'
import { resolveHelixMcpServerEntry } from '../research-tools/helix-mcp-server-entry'
import { setUpResearchProject } from '../research-tools/research-project-scaffold'
import { resolveAuthorizedPath } from './filesystem/filesystem-auth'

export function registerResearchToolsHandlers(store: Store): void {
  ipcMain.handle(
    'researchTools:setUpProject',
    async (
      _event,
      args: { projectPath: string; offline?: boolean }
    ): Promise<ResearchProjectSetupResult> => {
      // Only registered project folders may be written to.
      const projectDir = await resolveAuthorizedPath(args.projectPath, store)
      const entry = await resolveHelixMcpServerEntry({ offline: args.offline === true })
      if (!entry) {
        return {
          ok: false,
          reason: 'research-tools-unavailable',
          detail: 'This build does not include helix-mcp. Run pnpm build:helix-mcp.'
        }
      }
      return setUpResearchProject(projectDir, entry)
    }
  )
}
