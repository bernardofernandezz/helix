import { build } from 'esbuild'
import { join } from 'node:path'
import { HELIXD_LINEAR_SDK_ENTRY } from '../../src/shared/helixd-artifacts.ts'

// Bundle @linear/sdk into one CJS file for lazy require: copying would expose chunk names that change each release.
export async function stageHelixdLinearSdk(root, outputDir) {
  await build({
    stdin: {
      contents: "module.exports = require('@linear/sdk')",
      resolveDir: root,
      sourcefile: 'helixd-linear-sdk-entry.js'
    },
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: join(outputDir, HELIXD_LINEAR_SDK_ENTRY),
    minify: true,
    sourcemap: false,
    logLevel: 'error'
  })
}
