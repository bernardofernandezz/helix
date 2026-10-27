import { join } from 'node:path'
import { hashHelixdLauncher } from '../../shared/helixd-build-identity'
import { HELIXD_LAUNCHER_FILENAME } from '../../shared/helixd-artifacts'

export function computeLocalHelixdBuildHash(localHelixdDir: string): string {
  return hashHelixdLauncher(join(localHelixdDir, HELIXD_LAUNCHER_FILENAME))
}
