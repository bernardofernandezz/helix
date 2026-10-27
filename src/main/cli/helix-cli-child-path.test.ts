import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'

const shim = vi.hoisted(() => ({ ensureLinuxTerminalHelixCliShimDir: vi.fn() }))
vi.mock('./linux-terminal-helix-cli-shim', () => shim)

import { prependHelixCliDirToChildPath } from './helix-cli-child-path'

const USER_DATA = '/data/helix'
const RESOURCES = '/app/Resources'
const SHIM_DIR = join(USER_DATA, 'linux-helix-cli-shim')

beforeEach(() => {
  installFakeAppEnvironment()
  shim.ensureLinuxTerminalHelixCliShimDir.mockReset()
  shim.ensureLinuxTerminalHelixCliShimDir.mockReturnValue(SHIM_DIR)
})

afterEach(() => installFakeAppEnvironment())

describe('prependHelixCliDirToChildPath', () => {
  it.each(['linux', 'darwin'] as const)(
    'uses the %s execution host CLI and profile over inherited values',
    (platform) => {
      const launcher = join(USER_DATA, 'cli', 'bin', 'helix')
      installFakeAppEnvironment({ getCliLauncherPath: () => launcher })
      const env: Record<string, string> = {
        PATH: `/usr/bin:${join(USER_DATA, 'cli', 'bin')}::/bin`,
        HELIX_USER_DATA_PATH: '/parent/profile',
        HELIX_CLI_COMMAND: '/parent/helix',
        HELIX_CLI_BIN_DIR: '/parent/bin'
      }
      expect(
        prependHelixCliDirToChildPath(env, {
          isPackaged: true,
          userDataPath: USER_DATA,
          resourcesPath: null,
          platform
        })
      ).toBe(launcher)
      expect(env.PATH).toBe(`${join(USER_DATA, 'cli', 'bin')}:/usr/bin:/bin`)
      expect(env.HELIX_USER_DATA_PATH).toBe(USER_DATA)
      expect(env.HELIX_CLI_COMMAND).toBe(launcher)
      expect(env.HELIX_CLI_BIN_DIR).toBe(join(USER_DATA, 'cli', 'bin'))
      expect(shim.ensureLinuxTerminalHelixCliShimDir).not.toHaveBeenCalled()
    }
  )
  it('puts a Windows execution host CLI first on Path without a POSIX restore dir', () => {
    const binDir = join(USER_DATA, 'cli', 'bin')
    const launcher = join(binDir, 'helix.exe')
    installFakeAppEnvironment({ getCliLauncherPath: () => launcher })
    const env: Record<string, string> = {
      Path: `C:\\Windows;${binDir};;C:\\Tools`,
      HELIX_USER_DATA_PATH: 'C:\\parent\\profile',
      HELIX_CLI_COMMAND: 'C:\\parent\\helix.exe',
      HELIX_CLI_BIN_DIR: '/parent/bin'
    }
    expect(
      prependHelixCliDirToChildPath(env, {
        isPackaged: true,
        userDataPath: USER_DATA,
        resourcesPath: null,
        platform: 'win32'
      })
    ).toBe(launcher)
    expect(env).toEqual({
      Path: `${binDir};C:\\Windows;C:\\Tools`,
      HELIX_USER_DATA_PATH: USER_DATA,
      HELIX_CLI_COMMAND: launcher
    })
  })
  it('leads packaged Linux PATH with the bare-helix shim dir', () => {
    const env: Record<string, string> = { PATH: '/usr/local/bin:/usr/bin' }
    prependHelixCliDirToChildPath(env, {
      isPackaged: true,
      userDataPath: USER_DATA,
      resourcesPath: RESOURCES,
      platform: 'linux'
    })
    expect(env.PATH).toBe(`${SHIM_DIR}:/usr/local/bin:/usr/bin`)
    expect(env.HELIX_CLI_BIN_DIR).toBe(SHIM_DIR)
    expect(shim.ensureLinuxTerminalHelixCliShimDir).toHaveBeenCalledWith({
      userDataPath: USER_DATA
    })
  })

  it('promotes an already-present shim dir instead of duplicating it', () => {
    const env: Record<string, string> = { PATH: `/usr/bin:${SHIM_DIR}::/bin` }
    prependHelixCliDirToChildPath(env, {
      isPackaged: true,
      userDataPath: USER_DATA,
      platform: 'linux'
    })
    expect(env.PATH).toBe(`${SHIM_DIR}:/usr/bin:/bin`)
  })

  it('leaves packaged Linux PATH untouched when no shim could be written', () => {
    shim.ensureLinuxTerminalHelixCliShimDir.mockReturnValue(null)
    const env: Record<string, string> = { PATH: '/usr/bin', HELIX_CLI_BIN_DIR: '/old-host/cli' }
    prependHelixCliDirToChildPath(env, {
      isPackaged: true,
      userDataPath: USER_DATA,
      platform: 'linux'
    })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HELIX_CLI_BIN_DIR).toBeUndefined()
  })

  it('leads packaged macOS PATH with the bundled CLI dir', () => {
    const env: Record<string, string> = { PATH: '/usr/bin' }
    prependHelixCliDirToChildPath(env, {
      isPackaged: true,
      userDataPath: USER_DATA,
      resourcesPath: RESOURCES,
      platform: 'darwin'
    })
    expect(env.PATH).toBe(`${join(RESOURCES, 'bin')}:/usr/bin`)
    expect(env.HELIX_CLI_BIN_DIR).toBe(join(RESOURCES, 'bin'))
    expect(shim.ensureLinuxTerminalHelixCliShimDir).not.toHaveBeenCalled()
  })

  it('leads packaged Windows PATH with the bundled CLI dir under the env block spelling', () => {
    const env: Record<string, string> = {
      Path: 'C:\\Windows\\System32',
      HELIX_CLI_BIN_DIR: '/parent-host/cli',
      HELIX_WSL_CLI_DIR: '/guest/helix/bin'
    }
    prependHelixCliDirToChildPath(env, {
      isPackaged: true,
      userDataPath: USER_DATA,
      resourcesPath: RESOURCES,
      platform: 'win32'
    })
    expect(env.Path).toBe(`${join(RESOURCES, 'bin')};C:\\Windows\\System32`)
    expect(env.PATH).toBeUndefined()
    expect(env.HELIX_CLI_BIN_DIR).toBeUndefined()
    expect(env.HELIX_WSL_CLI_DIR).toBe('/guest/helix/bin')
  })

  it('leaves a packaged darwin/win32 PATH alone with no resources root', () => {
    const env: Record<string, string> = { PATH: '/usr/bin' }
    prependHelixCliDirToChildPath(env, {
      isPackaged: true,
      userDataPath: USER_DATA,
      resourcesPath: null,
      platform: 'darwin'
    })
    expect(env.PATH).toBe('/usr/bin')
  })

  it.each<[NodeJS.Platform, string]>([
    ['linux', ':'],
    ['darwin', ':'],
    ['win32', ';']
  ])('leads an unpackaged %s PATH with the dev launcher dir', (platform, pathDelimiter) => {
    const env: Record<string, string> = { PATH: '/usr/bin' }
    prependHelixCliDirToChildPath(env, {
      isPackaged: false,
      userDataPath: USER_DATA,
      resourcesPath: RESOURCES,
      platform
    })
    expect(env.PATH).toBe(`${join(USER_DATA, 'cli', 'bin')}${pathDelimiter}/usr/bin`)
    expect(env.HELIX_CLI_BIN_DIR).toBe(
      platform === 'win32' ? undefined : join(USER_DATA, 'cli', 'bin')
    )
    expect(shim.ensureLinuxTerminalHelixCliShimDir).not.toHaveBeenCalled()
  })

  it('writes no trailing delimiter when nothing was inherited', () => {
    const env: Record<string, string> = { PATH: '' }
    const inheritedPath = process.env.PATH
    delete process.env.PATH
    try {
      prependHelixCliDirToChildPath(env, {
        isPackaged: false,
        userDataPath: USER_DATA,
        platform: 'linux'
      })
    } finally {
      if (inheritedPath !== undefined) {
        process.env.PATH = inheritedPath
      }
    }
    // Why: an empty trailing segment resolves as `.` in some shells.
    expect(env.PATH).toBe(join(USER_DATA, 'cli', 'bin'))
  })
})
