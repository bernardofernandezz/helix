#!/usr/bin/env node
// Bundle helix-mcp with its dependencies into one ESM file the app runs through its own Node runtime.
import { build } from 'esbuild'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const OUT_DIR = process.env.HELIX_MCP_OUT_DIR ?? join(ROOT, 'out', 'helix-mcp')
const HELIX_MCP_BUNDLE_FILENAME = 'helix-mcp.mjs'

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

await build({
  entryPoints: [join(ROOT, 'src', 'packages', 'helix-mcp', 'src', 'cli.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: join(OUT_DIR, HELIX_MCP_BUNDLE_FILENAME),
  minify: true,
  legalComments: 'eof',
  // Bundled CommonJS dependencies still call require() for Node builtins.
  banner: {
    js: "import { createRequire } from 'node:module';const require=createRequire(import.meta.url);"
  },
  logLevel: 'warning'
})
console.log(`Built helix-mcp → ${join(OUT_DIR, HELIX_MCP_BUNDLE_FILENAME)}`)
