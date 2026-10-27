import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import { resolveProviderChildEnv } from '../provider-process/provider-process-launch'

const shim = vi.hoisted(() => ({ ensureLinuxTerminalHelixCliShimDir: vi.fn() }))
vi.mock('../cli/linux-terminal-helix-cli-shim', () => shim)

import {
  SEALED_TEST_SPAWN_TOKEN,
  sealedChildEnv
} from './structured-session-child-env.test-support'
import {
  mintStructuredWorkerHandle,
  mintStructuredWorkerPaneKey,
  structuredWorkerHostScope,
  structuredWorkerIdentities,
  structuredWorkerProcessIncarnation
} from './structured-worker-identity'

const SESSION_ID = 'f7a1c0de-1111-4222-8333-444455556666'
const USER_DATA = '/data/helix'
const RESOURCES = '/app/Resources'
const SHIM_DIR = join(USER_DATA, 'linux-helix-cli-shim')

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

function pinPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

function registerWorker(): string {
  const handle = mintStructuredWorkerHandle()
  structuredWorkerIdentities.register({
    handle,
    sessionId: SESSION_ID,
    agent: 'claude',
    paneKey: mintStructuredWorkerPaneKey(SESSION_ID),
    processIncarnation: structuredWorkerProcessIncarnation(SESSION_ID),
    worktreeId: 'wt_1',
    hostScope: { kind: 'local', hostId: 'local' }
  })
  return handle
}

beforeEach(() => {
  shim.ensureLinuxTerminalHelixCliShimDir.mockReset()
  shim.ensureLinuxTerminalHelixCliShimDir.mockReturnValue(SHIM_DIR)
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: RESOURCES })
})

afterEach(() => {
  structuredWorkerIdentities.clear()
  Object.defineProperty(process, 'platform', platformDescriptor)
  if (resourcesDescriptor) {
    Object.defineProperty(process, 'resourcesPath', resourcesDescriptor)
  } else {
    Reflect.deleteProperty(process, 'resourcesPath')
  }
})

describe('sealStructuredSessionChild identity', () => {
  it("gives an ordinary chat session its own id and this app's CLI, and no terminal identity", () => {
    // Session id prevents destructive orchestration check from guessing a sibling terminal's mailbox.
    pinPlatform('linux')
    installFakeAppEnvironment({ isPackaged: () => true, getPath: () => USER_DATA })
    const childEnv = { PATH: '/usr/bin' }
    const env = sealedChildEnv(SESSION_ID, childEnv)
    expect(env).toEqual({
      PATH: `${SHIM_DIR}:/usr/bin`,
      HELIX_AGENT_SESSION_ID: SESSION_ID,
      // For a CLI that predates the id, which refuses on it instead of guessing a sibling.
      HELIX_STRUCTURED_SESSION: '1',
      HELIX_CLI_COMMAND: join(SHIM_DIR, 'helix'),
      HELIX_CLI_BIN_DIR: SHIM_DIR,
      // The instance that minted the id, so any current CLI dials it rather than the default.
      HELIX_USER_DATA_PATH: USER_DATA,
      // Empty, which the CLI reads as unset, so a profile's selector cannot send it elsewhere.
      HELIX_ENVIRONMENT: '',
      HELIX_PAIRING_CODE: '',
      HELIX_REMOTE_PAIRING: '',
      HELIX_AGENT_SESSION_SPAWN_TOKEN: SEALED_TEST_SPAWN_TOKEN
    })
    // A chat names itself by its id alone: no handle, no pane key.
    expect(env.HELIX_TERMINAL_HANDLE).toBeUndefined()
    expect(env.HELIX_PANE_KEY).toBeUndefined()
    expect(childEnv).toEqual({ PATH: '/usr/bin' })
  })

  it.each(['HELIX_ENVIRONMENT', 'HELIX_PAIRING_CODE', 'HELIX_REMOTE_PAIRING'])(
    "keeps an inherited %s from sending the agent's CLI to another server",
    (key) => {
      installFakeAppEnvironment({ isPackaged: () => true, getPath: () => USER_DATA })
      // A profile's export reaches both the shell snapshot a launch builds on and the server's
      // own env, which the spawn merges under the launch's overlay.
      const inherited = { PATH: '/usr/bin', [key]: 'other-server' }
      const launch = { env: sealedChildEnv(SESSION_ID, inherited) }
      const childEnv = resolveProviderChildEnv(launch, inherited)
      expect(childEnv).toMatchObject({
        HELIX_USER_DATA_PATH: USER_DATA,
        HELIX_ENVIRONMENT: '',
        HELIX_PAIRING_CODE: '',
        HELIX_REMOTE_PAIRING: ''
      })
    }
  )

  it('replaces an id inherited from an Helix launched inside another session', () => {
    installFakeAppEnvironment({ isPackaged: () => false, getPath: () => USER_DATA })
    const env = sealedChildEnv(SESSION_ID, {
      HELIX_AGENT_SESSION_ID: 'a0b1c2d3-0000-4000-8000-00000000abcd',
      PATH: '/usr/bin'
    })
    expect(env.HELIX_AGENT_SESSION_ID).toBe(SESSION_ID)
  })

  it('gives a structured worker its id and keeps the handle it was minted', () => {
    // Orchestration maps session id back to the worker handle; other surfaces still use the handle directly.
    installFakeAppEnvironment({ isPackaged: () => false, getPath: () => USER_DATA })
    const handle = registerWorker()
    const env = sealedChildEnv(SESSION_ID, { PATH: '/usr/bin' })
    expect(env.HELIX_AGENT_SESSION_ID).toBe(SESSION_ID)
    expect(env.HELIX_TERMINAL_HANDLE).toBe(handle)
  })

  describe.each(['chat', 'worker'] as const)("reaches this app's CLI as a %s", (kind) => {
    it('reaches a headless host CLI without Electron resources', () => {
      const launcher = join(USER_DATA, 'cli', 'bin', 'helix')
      installFakeAppEnvironment({
        isPackaged: () => true,
        getPath: () => USER_DATA,
        getCliLauncherPath: () => launcher
      })
      const env = sealedChildEnv(SESSION_ID, {
        PATH: '/usr/bin',
        HELIX_USER_DATA_PATH: '/other/profile',
        HELIX_ENVIRONMENT: 'stale-shell-selection',
        HELIX_PAIRING_CODE: 'stale-pairing',
        HELIX_REMOTE_PAIRING: 'stale-remote-pairing'
      })
      expect(env.HELIX_CLI_COMMAND).toBe(launcher)
      expect(env.HELIX_USER_DATA_PATH).toBe(USER_DATA)
      expect(env).toMatchObject({
        HELIX_ENVIRONMENT: '',
        HELIX_PAIRING_CODE: '',
        HELIX_REMOTE_PAIRING: ''
      })
      expect(env.HELIX_AGENT_SESSION_ID).toBe(SESSION_ID)
      expect(env.PATH).toBe(`${join(USER_DATA, 'cli', 'bin')}:/usr/bin`)
    })
    beforeEach(() => {
      if (kind === 'worker') {
        registerWorker()
      }
    })

    it('on packaged Linux, through the bare-helix shim, named by absolute path', () => {
      // Bare helix on Linux is GNOME's screen reader; this app installs as helix-ide.
      pinPlatform('linux')
      installFakeAppEnvironment({ isPackaged: () => true, getPath: () => USER_DATA })
      const env = sealedChildEnv(SESSION_ID, { PATH: '/usr/bin:/bin' })
      expect(env.HELIX_CLI_COMMAND).toBe(join(SHIM_DIR, 'helix'))
      expect(env.PATH).toBe(`${SHIM_DIR}:/usr/bin:/bin`)
    })

    it('on packaged macOS, through the bundled CLI dir', () => {
      pinPlatform('darwin')
      installFakeAppEnvironment({ isPackaged: () => true, getPath: () => USER_DATA })
      const env = sealedChildEnv(SESSION_ID, { PATH: '/usr/bin' })
      expect(env.PATH).toBe(`${join(RESOURCES, 'bin')}:/usr/bin`)
      expect(env.HELIX_CLI_COMMAND).toBe(join(RESOURCES, 'bin', 'helix'))
    })

    it('on packaged Windows, through the bundled CLI dir under the env block spelling', () => {
      pinPlatform('win32')
      installFakeAppEnvironment({ isPackaged: () => true, getPath: () => USER_DATA })
      const env = sealedChildEnv(SESSION_ID, { Path: 'C:\\Windows' })
      expect(env.Path).toBe(`${join(RESOURCES, 'bin')};C:\\Windows`)
      expect(env.PATH).toBeUndefined()
      // The native launcher: `helix.cmd` refuses message bodies cmd.exe would mangle.
      expect(env.HELIX_CLI_COMMAND).toBe(join(RESOURCES, 'bin', 'helix.exe'))
      expect(env.HELIX_CLI_BIN_DIR).toBeUndefined()
    })

    it('unpackaged, through the dev launcher dir', () => {
      pinPlatform('darwin')
      installFakeAppEnvironment({ isPackaged: () => false, getPath: () => USER_DATA })
      const env = sealedChildEnv(SESSION_ID, { PATH: '/usr/bin' })
      expect(env.PATH).toBe(`${join(USER_DATA, 'cli', 'bin')}:/usr/bin`)
      expect(env.HELIX_CLI_COMMAND).toBe(join(USER_DATA, 'cli', 'bin', 'helix-dev'))
    })
  })

  it('omits the CLI command when no launcher resolves, never naming a bare `helix`', () => {
    // An unresolved bundled launcher cannot fall back to bare or inherited helix: those can launch GNOME or another app.
    pinPlatform('linux')
    installFakeAppEnvironment({ isPackaged: () => true, getPath: () => USER_DATA })
    shim.ensureLinuxTerminalHelixCliShimDir.mockReturnValue(null)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env = sealedChildEnv(SESSION_ID, {
      PATH: '/usr/bin',
      HELIX_CLI_COMMAND: '/Applications/Other Helix.app/Contents/Resources/bin/helix',
      HELIX_USER_DATA_PATH: '/data/other-helix'
    })
    expect(env).not.toHaveProperty('HELIX_CLI_COMMAND')
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HELIX_USER_DATA_PATH).toBe(USER_DATA)
    expect(console.warn).toHaveBeenCalledOnce()
  })

  it('never puts a pane key in the child environment', () => {
    // Hook attestation, agent rows and mobile projections assume pane keys name live PTY leaves.
    pinPlatform('linux')
    installFakeAppEnvironment({ isPackaged: () => true, getPath: () => USER_DATA })
    registerWorker()
    const env = sealedChildEnv(SESSION_ID, { PATH: '/usr/bin' })
    expect(env.HELIX_PANE_KEY).toBeUndefined()
    expect(Object.keys(env).filter((key) => key.includes('PANE'))).toEqual([])
  })

  it('never names the WSL-scoped launcher, because a structured worker cannot run in WSL', () => {
    // WSL exports helix-ide for PTYs; structured WSL sessions cannot become workers, so Linux needs the bare-helix shim.
    expect(
      structuredWorkerHostScope({
        executionHostId: 'local',
        workspaceId: 'wt_1',
        workspaceKind: 'git-worktree',
        wslDistro: 'Ubuntu'
      })
    ).toBeNull()
    pinPlatform('linux')
    installFakeAppEnvironment({ isPackaged: () => true, getPath: () => USER_DATA })
    registerWorker()
    expect(sealedChildEnv(SESSION_ID, { PATH: '/usr/bin' }).HELIX_CLI_COMMAND).not.toBe('helix-ide')
  })
})
