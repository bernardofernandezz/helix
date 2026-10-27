export const HELIX_RESEARCH_MCP_SERVER_NAME = 'helix-research'

export type ResearchProjectSetupResult =
  | {
      ok: true
      /** Project-relative paths this setup created; existing files are never overwritten. */
      created: string[]
      /** Whether `.mcp.json` gained or refreshed the helix-research server. */
      mcpConfigUpdated: boolean
    }
  | { ok: false; reason: 'research-tools-unavailable' | 'invalid-mcp-config'; detail: string }
