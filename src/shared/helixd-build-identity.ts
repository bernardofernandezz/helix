import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { HELIXD_LAUNCHER_FILENAME, HELIXD_SERVER_ENTRY_FILENAME } from './helixd-artifacts'

export const HELIXD_BUILD_HASH_LENGTH = 16

/** The launcher embeds its server digest, keeping the hash older clients calculate. */
export function hashHelixdLauncher(entryPath: string): string {
  const entry = realpathSync(entryPath)
  const launcher =
    basename(entry) === HELIXD_SERVER_ENTRY_FILENAME
      ? join(dirname(entry), HELIXD_LAUNCHER_FILENAME)
      : entry
  return createHash('sha256')
    .update(readFileSync(launcher))
    .digest('hex')
    .slice(0, HELIXD_BUILD_HASH_LENGTH)
}
