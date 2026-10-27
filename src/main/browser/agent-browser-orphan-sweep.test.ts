import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runProcessMock = vi.fn()
vi.mock('@helix/process-host', () => ({
  runProcess: (spec: unknown) => runProcessMock(spec)
}))

import { sweepOrphanedAgentBrowserSessions } from './agent-browser-orphan-sweep'

type Spec = { args?: readonly string[] }

const BIN = '/opt/helix/agent-browser'
const SCOPED = {
  env: { AGENT_BROWSER_SOCKET_DIR: '/tmp/helix-ab-0123456789abcdef' },
  ownsSocketDirectory: true
}

function respond(sessions: string[]): void {
  runProcessMock.mockImplementation((spec: Spec) => {
    if (spec.args?.[0] === 'session') {
      return Promise.resolve({
        code: 0,
        signal: null,
        stdout: JSON.stringify({ success: true, data: { sessions } }),
        stderr: '',
        timedOut: false
      })
    }
    return Promise.resolve({ code: 0, signal: null, stdout: '', stderr: '', timedOut: false })
  })
}

function closedArgs(): string[][] {
  return runProcessMock.mock.calls
    .map((call) => [...((call[0] as Spec).args ?? [])])
    .filter((args) => args.includes('close'))
}

describe('agent-browser orphan sweep', () => {
  beforeEach(() => {
    runProcessMock.mockReset()
  })

  it('never closes a daemon outside Helix tab naming', async () => {
    respond(['default', 'agent1', 'helix-helixd-deadbeef', 'helix-tab-aaa'])

    await sweepOrphanedAgentBrowserSessions({ binaryPath: BIN, ...SCOPED })

    expect(closedArgs()).toEqual([['--session', 'helix-tab-aaa', 'close']])
  })

  it('leaves sessions this run already owns alone', async () => {
    respond(['helix-tab-live', 'helix-tab-orphan'])

    await sweepOrphanedAgentBrowserSessions({
      binaryPath: BIN,
      ...SCOPED,
      isSessionLive: (name) => name === 'helix-tab-live'
    })

    expect(closedArgs()).toEqual([['--session', 'helix-tab-orphan', 'close']])
  })

  it.each([
    ['no socket directory at all', { PATH: 'C:\\Windows' }],
    ['a socket directory Helix inherited', { AGENT_BROWSER_SOCKET_DIR: '/tmp/shared-ab' }]
  ])('does not enumerate with %s', async (_label, env) => {
    respond(['helix-tab-aaa'])

    const closed = await sweepOrphanedAgentBrowserSessions({
      binaryPath: BIN,
      env,
      ownsSocketDirectory: false
    })

    expect(closed).toEqual([])
    expect(runProcessMock).not.toHaveBeenCalled()
  })

  it('closes nothing when the listing is unusable', async () => {
    runProcessMock.mockResolvedValue({
      code: 1,
      signal: null,
      stdout: 'not json',
      stderr: 'boom',
      timedOut: false
    })

    await expect(
      sweepOrphanedAgentBrowserSessions({ binaryPath: BIN, ...SCOPED })
    ).resolves.toEqual([])
    expect(closedArgs()).toEqual([])
  })

  it('keeps sweeping after one close fails', async () => {
    runProcessMock.mockImplementation((spec: Spec) => {
      if (spec.args?.[0] === 'session') {
        return Promise.resolve({
          code: 0,
          signal: null,
          stdout: JSON.stringify({ data: { sessions: ['helix-tab-aaa', 'helix-tab-bbb'] } }),
          stderr: '',
          timedOut: false
        })
      }
      if (spec.args?.[1] === 'helix-tab-aaa') {
        return Promise.reject(new Error('spawn failed'))
      }
      return Promise.resolve({ code: 0, signal: null, stdout: '', stderr: '', timedOut: false })
    })

    const closed = await sweepOrphanedAgentBrowserSessions({ binaryPath: BIN, ...SCOPED })

    expect(closed).toEqual(['helix-tab-bbb'])
  })
})

describe('sweep kill switch', () => {
  const previous = process.env.HELIX_DISABLE_AGENT_BROWSER_SWEEP

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.HELIX_DISABLE_AGENT_BROWSER_SWEEP
    } else {
      process.env.HELIX_DISABLE_AGENT_BROWSER_SWEEP = previous
    }
  })

  it('enumerates nothing when disabled, even when Helix owns the socket directory', async () => {
    process.env.HELIX_DISABLE_AGENT_BROWSER_SWEEP = '1'
    runProcessMock.mockClear()

    const closed = await sweepOrphanedAgentBrowserSessions({
      binaryPath: BIN,
      env: {},
      ownsSocketDirectory: true
    })

    expect(closed).toEqual([])
    expect(runProcessMock).not.toHaveBeenCalled()
  })
})
