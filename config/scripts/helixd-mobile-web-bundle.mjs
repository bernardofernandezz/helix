import { cpSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  HELIXD_MOBILE_WEB_DIR,
  HELIXD_MOBILE_WEB_MANIFEST,
  helixdMobileWebAssetFilenames
} from '../../src/shared/helixd-artifacts.ts'

const { MOBILE_WEB_BUNDLE_DIR, assertMobileWebBundleBuilt } = createRequire(import.meta.url)(
  './verify-packaged-mobile-web-bundle.cjs'
)
const { assertNoDarkOutputOfOffSwitches } = createRequire(import.meta.url)(
  '../dark-build-switches.cjs'
)

// Require a fresh built page as beforePack does: an helixd package without it cannot serve phones.
export function stageHelixdMobileWebBundle(outputDir, bundleDir = MOBILE_WEB_BUNDLE_DIR) {
  // The release template refuses the variable itself.
  assertNoDarkOutputOfOffSwitches([bundleDir])
  assertMobileWebBundleBuilt(bundleDir)
  // The guard refuses unlisted files, so the tree is the manifest, its assets and a dark marker.
  cpSync(bundleDir, join(outputDir, ...HELIXD_MOBILE_WEB_DIR.split('/')), { recursive: true })
}

export function readHelixdMobileWebAssetFilenames(packageDir) {
  return helixdMobileWebAssetFilenames(
    readFileSync(join(packageDir, ...HELIXD_MOBILE_WEB_MANIFEST.split('/')), 'utf8')
  )
}
