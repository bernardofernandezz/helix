const { existsSync } = require('node:fs')
const { join } = require('node:path')

// The research tools server runs from real disk with ELECTRON_RUN_AS_NODE; it must not live inside app.asar.
function assertPackagedHelixMcp(resourcesDir) {
  const bundle = join(resourcesDir, 'helix-mcp', 'helix-mcp.mjs')
  if (!existsSync(bundle)) {
    throw new Error(
      `[verify-packaged-helix-mcp] missing ${bundle}. Run pnpm build:helix-mcp before packaging.`
    )
  }
}

module.exports = { assertPackagedHelixMcp }
