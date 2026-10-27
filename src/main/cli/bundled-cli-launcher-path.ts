import { join } from 'node:path'

// Why `helix-ide` on Linux: GNOME Helix ships /usr/bin/helix, so the CLI never claims that name.
export const LINUX_CLI_COMMAND_NAME = 'helix-ide'

// Keep path-only callers independent of cli-installer's Electron dependency.
export function getBundledLauncherPath(
  platform: NodeJS.Platform,
  resourcesPath: string
): string | null {
  if (platform === 'darwin') {
    return join(resourcesPath, 'bin', 'helix')
  }
  if (platform === 'linux') {
    return join(resourcesPath, 'bin', LINUX_CLI_COMMAND_NAME)
  }
  if (platform === 'win32') {
    return join(resourcesPath, 'bin', 'helix.exe')
  }
  return null
}
