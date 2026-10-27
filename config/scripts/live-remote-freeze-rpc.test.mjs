import { describe, expect, it } from 'vitest'
import {
  appendHelixRpcOutput,
  resolveHelixCliCommand,
  resolveHelixCliInvocation
} from './live-remote-freeze-rpc.mjs'

describe('live remote freeze RPC', () => {
  it('resolves the Helix CLI for managed, dev, Linux, and default runtimes', () => {
    expect(resolveHelixCliCommand({ env: { HELIX_CLI_COMMAND: 'custom-helix' } })).toBe(
      'custom-helix'
    )
    expect(resolveHelixCliCommand({ env: { HELIX_DEV_REPO_ROOT: '/repo' } })).toBe('helix-dev')
    expect(resolveHelixCliCommand({ env: {}, platform: 'linux' })).toBe('helix-ide')
    expect(resolveHelixCliCommand({ env: {}, platform: 'win32' })).toBe('helix')
  })

  it('bypasses the Windows dev cmd shim with the built Node CLI', () => {
    const invocation = resolveHelixCliInvocation({
      env: {
        APPDATA: 'C:\\Users\\dev\\AppData\\Roaming',
        HELIX_CLI_COMMAND: 'C:\\repo\\out\\bin\\helix-dev.cmd',
        HELIX_DEV_REPO_ROOT: 'C:\\repo'
      },
      platform: 'win32',
      nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe'
    })

    expect(invocation).toMatchObject({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      prefixArgs: ['C:\\repo\\out\\cli\\index.js'],
      env: {
        HELIX_USER_DATA_PATH: 'C:\\Users\\dev\\AppData\\Roaming\\helix-dev',
        HELIX_DEV_CLI_INVOCATION: '1',
        HELIX_APP_EXECUTABLE: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
        HELIX_APP_EXECUTABLE_NEEDS_APP_ROOT: '1'
      }
    })
  })

  it('caps combined asynchronous output before retaining the overflow chunk', () => {
    const first = appendHelixRpcOutput('', '1234', 0, 5)
    expect(first).toEqual({ output: '1234', bytes: 4, exceeded: false })

    const overflow = appendHelixRpcOutput(first.output, '67', first.bytes, 5)
    expect(overflow).toEqual({ output: '1234', bytes: 6, exceeded: true })
  })
})
