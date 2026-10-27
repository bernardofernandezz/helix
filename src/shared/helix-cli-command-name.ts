export function getHelixCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return 'helix-ide'
  }
  if (platform === 'win32') {
    return 'helix.cmd'
  }
  return 'helix'
}
