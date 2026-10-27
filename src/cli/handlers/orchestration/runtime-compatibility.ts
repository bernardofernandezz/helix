import { RuntimeClientError } from '../../runtime-client'

export function resolveCompatibilityCliCommand(): 'helix' | 'helix-ide' | 'helix-dev' {
  const configured = process.env.HELIX_CLI_COMMAND
  if (configured === 'helix' || configured === 'helix-ide' || configured === 'helix-dev') {
    return configured
  }
  return process.platform === 'linux' ? 'helix-ide' : 'helix'
}

export function resolvePackagedWindowsCompatibilityCommand(): 'helix' | 'helix-ide' | undefined {
  if (process.env.HELIX_WINDOWS_PACKAGED_CLI_LAUNCHER !== '1') {
    return undefined
  }
  const command = process.env.HELIX_CLI_COMMAND
  if (command === 'helix' || command === 'helix-ide') {
    return command
  }
  throw new RuntimeClientError(
    'invalid_argument',
    'The packaged Helix launcher did not provide a valid resume command. No question was created.'
  )
}

export async function flushOrchestrationStdout(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write('', (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export function isDevCliInvocation(): boolean {
  return (
    process.env.HELIX_DEV_CLI_INVOCATION === '1' ||
    (process.env.HELIX_USER_DATA_PATH?.includes('helix-dev') ?? false)
  )
}
