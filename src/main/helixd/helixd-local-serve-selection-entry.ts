// App-side CLI probe under ELECTRON_RUN_AS_NODE: print one HELIX_SERVE_RUNTIME selection; diagnostics use stderr.
import { join } from 'node:path'
import process from 'node:process'
import {
  formatServeRuntimeSelection,
  HELIXD_LOCAL_SERVE_SELECTION_FLAGS as FLAGS
} from '../../shared/helixd-local-serve-selection'
import { selectServeRuntime } from './helixd-local-serve-selection'
import { pruneDesktopHelixdArtifactCache } from './helixd-artifact-cache-retention'
import { findAppImageNodeRuntime } from '../node-runtime/appimage-bundled-node-runtime'

function flagValue(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag)
  return index === -1 ? null : (argv[index + 1] ?? null)
}

async function run(argv: readonly string[]): Promise<void> {
  const userDataPath = flagValue(argv, FLAGS.userData)
  const appRoot = flagValue(argv, FLAGS.appRoot)
  if (!userDataPath || !appRoot) {
    throw new Error(`${FLAGS.userData} and ${FLAGS.appRoot} are required`)
  }
  const selection = await selectServeRuntime({
    env: process.env,
    platform: process.platform,
    userDataPath,
    templateDirs: [
      ...(process.resourcesPath ? [join(process.resourcesPath, 'helixd-template')] : []),
      join(appRoot, 'out', 'helixd-template')
    ],
    bundledNodeRuntime: findAppImageNodeRuntime(process.resourcesPath)
  })
  // helixd skips desktop startup, so bound the slot cache here too.
  await pruneDesktopHelixdArtifactCache(
    userDataPath,
    selection.kind === 'helixd' ? [selection.version] : []
  ).catch(() => [])
  process.stdout.write(`${formatServeRuntimeSelection(selection)}\n`, () => process.exit(0))
}

run(process.argv.slice(2)).catch((error: unknown) => {
  // Selection failure falls back to Electron rather than failing helix serve.
  const reason = `helixd selection failed: ${error instanceof Error ? error.message : String(error)}`
  process.stdout.write(`${formatServeRuntimeSelection({ kind: 'electron', reason })}\n`, () =>
    process.exit(0)
  )
})
