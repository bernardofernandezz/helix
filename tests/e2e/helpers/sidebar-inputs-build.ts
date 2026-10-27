import { existsSync } from 'node:fs'
import path from 'node:path'

/** Whether out/ holds an HELIX_SIDEBAR_INPUTS=main build (config/dark-build-switches.cjs marks it). */
export const SIDEBAR_INPUTS_BUILD = existsSync(
  path.join(process.cwd(), 'out', 'main', 'HELIX_SIDEBAR_INPUTS_MAIN')
)
