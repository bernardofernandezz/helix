import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HELIXD_PROFILE_PREFLIGHT_FLAG,
  HELIXD_STARTUP_PREFLIGHT_FLAG
} from '../../shared/helixd-profile-preflight'
import {
  HELIXD_CANCEL_MANAGED_STOP_FLAG,
  HELIXD_COMPLETE_MANAGED_STOP_FLAG
} from '../../shared/helixd-stop-request'

// Preflight must precede PTY imports because native loader failures may be uncatchable.
const { order, profileProbe, reserveStdout } = vi.hoisted(() => {
  const order: string[] = []
  return { order, profileProbe: vi.fn(async () => {}), reserveStdout: vi.fn() }
})

vi.mock('../server/serve-stdout-boundary', () => ({
  reserveServeStdoutForReadiness: reserveStdout
}))
vi.mock('./helixd-bundled-runtime', () => ({ assertHelixdServerRuntime: () => {} }))
vi.mock('./helixd-profile-preflight', () => ({
  preflightBundledHelixdStartup: async () => {
    order.push('profile-admission')
  },
  runHelixdProfilePreflight: profileProbe
}))

beforeEach(() => {
  vi.resetModules()
  order.length = 0
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

vi.mock('./helixd-native-preflight', () => ({
  runHelixdNativePreflight: () => {
    order.push('preflight')
    return true
  }
}))

vi.mock('./helixd-managed-stop-command', () => ({
  runHelixdManagedStopCommandAndExit: async (argv: string[]) => {
    order.push(`managed-stop:${argv.join(' ')}`)
  }
}))

vi.mock('./helixd-entry', () => ({
  main: vi.fn(async () => {
    order.push('main')
  })
}))

describe('helixd entry', () => {
  it.each([['--help'], ['-h'], ['--json', '--help'], ['--bind', '--help', '-h']])(
    'handles help before startup probes or stdout redirection: %j',
    async (...argv) => {
      vi.spyOn(process, 'argv', 'get').mockReturnValue(['runtime', 'helixd.js', ...argv])
      await import('./main')
      const { main } = await import('./helixd-entry')

      expect(main).toHaveBeenCalledWith(argv)
      expect(order).toEqual(['main'])
      expect(profileProbe).not.toHaveBeenCalled()
      expect(reserveStdout).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['--bind', '--help'],
    ['--pairing-address', '-h'],
    ['--project-root', '--help']
  ])('keeps startup probes when help is consumed as a value: %j', async (...argv) => {
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['runtime', 'helixd.js', ...argv])
    await import('./main')
    await vi.waitFor(() => expect(order).toContain('main'))

    expect(order).toEqual(['profile-admission', 'preflight', 'main'])
    expect(reserveStdout).toHaveBeenCalledOnce()
  })

  it.each([
    { flag: HELIXD_PROFILE_PREFLIGHT_FLAG, nativeFeatures: true },
    { flag: HELIXD_STARTUP_PREFLIGHT_FLAG, nativeFeatures: false }
  ])(
    'runs the selected disposable probe without starting a server: $flag',
    async ({ flag, nativeFeatures }) => {
      vi.spyOn(process, 'argv', 'get').mockReturnValue(['runtime', 'helixd.js', flag, 'nonce'])
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub only records the call; nothing reads its never return.
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
      await import('./main')
      expect(profileProbe).toHaveBeenCalledExactlyOnceWith('nonce', { nativeFeatures })
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
      expect(order).toEqual([])
    }
  )

  it('runs the native preflight before starting the runtime', async () => {
    await import('./main')
    await vi.waitFor(() => expect(order).toContain('main'))

    expect(order).toEqual(['profile-admission', 'preflight', 'main'])
  })

  it.each([HELIXD_COMPLETE_MANAGED_STOP_FLAG, HELIXD_CANCEL_MANAGED_STOP_FLAG])(
    'runs %s without preflights, the bundled handoff, or a runtime',
    async (flag) => {
      vi.spyOn(process, 'argv', 'get').mockReturnValue(['runtime', 'helixd.js', flag, '{}'])
      await import('./main')
      await vi.waitFor(() => expect(order).toHaveLength(1))

      expect(order).toEqual([`managed-stop:${flag} {}`])
    }
  )

  it('runs the Windows breakaway launcher without preflights or a runtime', async () => {
    vi.spyOn(process, 'argv', 'get').mockReturnValue([
      'runtime',
      'helixd.js',
      '--windows-breakaway-launch',
      '--stdout-file',
      'out',
      '--stderr-file',
      'err',
      '--helixd-args',
      '--json'
    ])
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((_chunk: unknown, callback?: unknown) => {
        if (typeof callback === 'function') {
          callback()
        }
        return true
      })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub only records the call; nothing reads its never return.
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    await import('./main')
    await vi.waitFor(() => expect(exit).toHaveBeenCalled())
    expect(String(write.mock.calls[0]?.[0])).toMatch(/^HELIX_HELIXD_LAUNCH /u)
    expect(order).toEqual([])
  })
})
