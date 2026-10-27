import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  HELIXD_MOBILE_WEB_MANIFEST,
  HELIXD_SERVER_TARGET_FILENAME,
  HELIXD_VERSION,
  helixdArtifactFilenames,
  helixdMobileWebAssetFilenames
} from '../../shared/helixd-artifacts'
import { COMPAT_SERVER_TARGETS, SERVER_TARGETS } from '../../shared/node-runtime-pin'
import { helixdAgentBrowserNativeName } from '../../shared/helixd-agent-browser-name'

/** Hash installed bytes in the build's order; a version marker is not proof of delivery. */
export async function readHelixdArtifactIdentity(directory: string): Promise<string> {
  const target = z
    .enum([...SERVER_TARGETS, ...COMPAT_SERVER_TARGETS])
    .parse((await readFile(join(directory, HELIXD_SERVER_TARGET_FILENAME), 'utf8')).trim())
  const platform = target.startsWith('win32-')
    ? 'win32'
    : target.startsWith('darwin-')
      ? 'darwin'
      : 'linux'
  const browser = helixdAgentBrowserNativeName(
    platform,
    target.split('-')[1] ?? '',
    target.endsWith('-musl') ? 'musl' : 'glibc'
  )
  const filenames = helixdArtifactFilenames(
    target,
    helixdMobileWebAssetFilenames(
      await readFile(join(directory, HELIXD_MOBILE_WEB_MANIFEST), 'utf8')
    )
  )
  if (existsSync(join(directory, browser))) {
    filenames.push(browser)
  }
  const hash = createHash('sha256')
  for (const filename of filenames) {
    for await (const chunk of createReadStream(join(directory, filename))) {
      hash.update(chunk)
    }
  }
  return `${HELIXD_VERSION}+${hash.digest('hex').slice(0, 12)}`
}
