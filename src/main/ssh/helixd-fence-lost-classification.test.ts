import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientChannel } from 'ssh2'
import { execHelixdStateMutation } from '../managed-server/host-state/helixd-state-mutation-exec'
import {
  execHelixdRemote,
  execHelixdRemoteOr
} from '../managed-server/install/helixd-remote-runtime-control'
import {
  HELIXD_FENCE_LOST_MARKER,
  HelixdFenceLostError,
  isHelixdFenceLost,
  posixHelixdFenceGuard,
  runWithHelixdFence
} from '../managed-server/activation/helixd-activation-fence-scope'
import {
  isUnconfirmedSshCommandTermination,
  sshCommandExitError
} from './remote-exec/remote-exec-command'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import type { HelixdHostTransport } from './helixd-host-transport'

/** Model an exec channel whose unreachable host never acknowledges close. */
class HostChannel extends EventEmitter {
  readonly stderr = Object.assign(new EventEmitter(), { resume: () => {} })
  readonly stdin = this
  close(): void {}
  resume(): void {}
  exit(code: number, stdout: string): void {
    this.emit('data', Buffer.from(stdout))
    this.emit('close', code)
  }
}

let channel: HostChannel
const commands: string[] = []
const conn = {
  exec: async (command: string) => {
    commands.push(command)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: execCommand reads only the channel events, close() and resume() HostChannel implements.
    return channel as unknown as ClientChannel
  },
  usesSystemSshTransport: () => false
}
const target = {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only exec and usesSystemSshTransport are read.
  conn: conn as unknown as HelixdHostTransport,
  host: getRemoteHostPlatform('linux-x64')
}
const fence = {
  lockDir: '/home/u/.helix-remote/.helixd-activation-transaction/.install-lock',
  token: 't1'
}

const mutation = `${posixHelixdFenceGuard(fence)} restore`

function fenced<T>(run: () => Promise<T>): Promise<T> {
  return runWithHelixdFence(fence, run)
}

async function settledAfter(step: Promise<unknown>, answer: () => void): Promise<unknown> {
  const settled = step.catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(0)
  answer()
  return settled
}

beforeEach(() => {
  vi.useFakeTimers()
  channel = new HostChannel()
  commands.length = 0
})
afterEach(() => {
  vi.useRealTimers()
})

// Real exec errors quote commands that contain the guard marker; that alone must not imply fence loss.
describe('a fenced step through the real exec', () => {
  it('stays an ordinary failure when the step itself exits nonzero', async () => {
    const error = await settledAfter(
      fenced(() => execHelixdRemote(target, 'false')),
      () => channel.exit(1, 'boom\n')
    )
    expect(commands[0]).toContain(HELIXD_FENCE_LOST_MARKER)
    expect(error).not.toBeInstanceOf(HelixdFenceLostError)
    expect(error).toMatchObject({ exitCode: 1, stdout: 'boom\n' })
  })

  it('lets a failed step fall back', async () => {
    const answer = await settledAfter(
      fenced(() => execHelixdRemoteOr(target, 'false', 'FALLBACK')),
      () => channel.exit(1, '')
    )
    expect(answer).toBe('FALLBACK')
  })

  it('keeps a timed-out step unconfirmed, so the fence is not released under it', async () => {
    const settled = fenced(() => execHelixdRemoteOr(target, 'sleep 99', 'FALLBACK')).catch(
      (error: unknown) => error
    )
    await vi.advanceTimersByTimeAsync(60_000)
    const error = await settled
    expect(error).not.toBeInstanceOf(HelixdFenceLostError)
    expect(isUnconfirmedSshCommandTermination(error)).toBe(true)
  })

  it('reads the guard’s own exit as a lost fence', async () => {
    const error = await settledAfter(
      fenced(() => execHelixdRemote(target, 'true')),
      () => channel.exit(75, `${HELIXD_FENCE_LOST_MARKER}\n`)
    )
    expect(error).toBeInstanceOf(HelixdFenceLostError)
  })

  it('does not read a marker-free exit 75 as a lost fence', async () => {
    const error = await settledAfter(
      fenced(() => execHelixdRemote(target, 'true')),
      () => channel.exit(75, 'other\n')
    )
    expect(error).not.toBeInstanceOf(HelixdFenceLostError)
  })
})

describe('a fenced state mutation through the real exec', () => {
  it('stays an ordinary failure when the mutation exits nonzero', async () => {
    const error = await settledAfter(
      fenced(() => execHelixdStateMutation(target, mutation)),
      () => channel.exit(2, 'no snapshot\n')
    )
    expect(error).not.toBeInstanceOf(HelixdFenceLostError)
    expect(isUnconfirmedSshCommandTermination(error)).toBe(false)
  })

  it('reads the guard’s own exit as a lost fence', async () => {
    const error = await settledAfter(
      fenced(() => execHelixdStateMutation(target, mutation)),
      () => channel.exit(75, `${HELIXD_FENCE_LOST_MARKER}\n`)
    )
    expect(error).toBeInstanceOf(HelixdFenceLostError)
  })
})

describe('a Windows host op whose exit PowerShell flattened to 1', () => {
  it('is a lost fence only when the host script printed the marker', () => {
    const op = `powershell.exe -Command "& 'node.exe' 'host.js' --fence d t ${HELIXD_FENCE_LOST_MARKER}"`
    expect(isHelixdFenceLost(sshCommandExitError(op, 1, `${HELIXD_FENCE_LOST_MARKER}\r\n`))).toBe(
      true
    )
    expect(isHelixdFenceLost(sshCommandExitError(op, 1, 'ENOENT\r\n'))).toBe(false)
  })
})
