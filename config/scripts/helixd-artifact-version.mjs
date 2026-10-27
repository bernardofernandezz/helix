import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HELIXD_VERSION, helixdArtifactFilenames } from '../../src/shared/helixd-artifacts.ts'
import { readHelixdMobileWebAssetFilenames } from './helixd-mobile-web-bundle.mjs'

/** The runtime enters through `.runtime-node`'s executableSha256 string, never its bytes (design D2). */
export function computeHelixdFullVersion(artifactDir, { target, agentBrowserFilename }) {
  const hash = createHash('sha256')
  for (const filename of helixdArtifactFilenames(
    target,
    readHelixdMobileWebAssetFilenames(artifactDir)
  )) {
    const artifactPath = join(artifactDir, filename)
    if (!existsSync(artifactPath)) {
      throw new Error(
        `helixd declares ${filename} in HELIXD_ARTIFACTS but never emitted it. Add the build ` +
          'step, or drop it from src/shared/helixd-artifacts.ts.'
      )
    }
    hash.update(readFileSync(artifactPath))
  }
  if (agentBrowserFilename && existsSync(join(artifactDir, agentBrowserFilename))) {
    hash.update(readFileSync(join(artifactDir, agentBrowserFilename)))
  }
  return `${HELIXD_VERSION}+${hash.digest('hex').slice(0, 12)}`
}
