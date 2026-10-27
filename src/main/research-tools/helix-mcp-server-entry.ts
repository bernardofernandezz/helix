import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { getAppEnvironment, hasAppEnvironment } from '../../shared/app-environment'

const BUNDLE_DIR_NAME = 'helix-mcp'
const BUNDLE_FILENAME = 'helix-mcp.mjs'

/** A stdio MCP server entry in the shape `.mcp.json` and agent configs expect. */
export type HelixMcpServerEntry = {
  command: string
  args: string[]
  env: Record<string, string>
}

function candidateBundles(): string[] {
  const candidates: string[] = []
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, BUNDLE_DIR_NAME, BUNDLE_FILENAME))
  }
  if (hasAppEnvironment() && getAppEnvironment().isPackaged()) {
    // Packaged installs must never fall back to a checkout in the launch directory.
    return candidates
  }
  for (const root of [
    hasAppEnvironment() ? getAppEnvironment().getAppPath() : null,
    process.cwd()
  ]) {
    if (root) {
      candidates.push(join(root, 'out', BUNDLE_DIR_NAME, BUNDLE_FILENAME))
    }
  }
  return candidates
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      await access(path)
      return path
    } catch {}
  }
  return null
}

/** Runs the bundled server with this app's own runtime, so users need no separate Node install. */
export async function resolveHelixMcpServerEntry(
  options: { offline?: boolean } = {}
): Promise<HelixMcpServerEntry | null> {
  const bundle = await firstExisting(candidateBundles())
  if (!bundle) {
    return null
  }
  return {
    command: process.execPath,
    args: [bundle, ...(options.offline ? ['--offline'] : [])],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }
}
