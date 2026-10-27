import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ExecCommandModule from '../../ssh/remote-exec/remote-exec-command'
import type * as RecordFile from './helixd-remote-record-file'
import type * as InstallLock from './remote-install-lock'

vi.mock('../../ssh/remote-exec/remote-exec-command', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecCommandModule>()),
  execCommand: vi.fn()
}))
vi.mock('../../../shared/shell-argument-quoting', () => ({
  quotePosixShell: (s: string) => `'${s}'`
}))
vi.mock('./remote-install-lock', async (importOriginal) => ({
  ...(await importOriginal<typeof InstallLock>()),
  acquireInstallLock: vi.fn()
}))
vi.mock('./helixd-remote-record-file', async (importOriginal) => ({
  ...(await importOriginal<typeof RecordFile>()),
  writeAtomicHelixdRemoteRecord: vi.fn()
}))

import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { acquireInstallLock } from './remote-install-lock'
import { writeAtomicHelixdRemoteRecord } from './helixd-remote-record-file'
import { decommissionRemoteHelixd } from './helixd-remote-decommission'
import { recoverInterruptedHelixdActivation } from '../activation/helixd-activation-recovery'
import { parseHelixdActivationRecord } from '../activation/helixd-activation-record'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import type { HelixdTerminalCensus } from '../../../shared/helixd-terminal-census'
import {
  FakeHelixdHost,
  OLD,
  type CrashMode
} from '../activation/helixd-activation-host-test-harness'

let host = new FakeHelixdHost()

const slot = {
  conn: Object.create(null),
  host: getRemoteHostPlatform('linux-x64'),
  remoteHome: '/home/u',
  nodePath: '/usr/bin/node',
  userDataDir: '/home/u/.helix',
  bindHost: '127.0.0.1',
  port: 7777,
  readinessTimeoutMs: 50,
  sleep: async () => {},
  now: () => new Date('2026-02-02T00:00:00.000Z')
}
const idle: HelixdTerminalCensus = {
  liveSessions: 0,
  startedSinceActivation: 0,
  daemonProtocolVersion: 3
}

function currentRecord() {
  const parsed = parseHelixdActivationRecord(host.record)
  if (parsed.state !== 'ok') {
    throw new Error('fixture record is unreadable')
  }
  return parsed.record
}

const decommission = (census: HelixdTerminalCensus = idle) =>
  decommissionRemoteHelixd({ ...slot, record: currentRecord(), census })

beforeEach(() => {
  vi.clearAllMocks()
  host = FakeHelixdHost.deployedOld()
  vi.mocked(execCommand).mockImplementation(async (_conn, command) => host.exec(command))
  vi.mocked(acquireInstallLock).mockImplementation(async (_conn, _root, _host, options) => {
    host.acquireFence(options)
  })
  vi.mocked(writeAtomicHelixdRemoteRecord).mockImplementation(async (_target, path, contents) =>
    host.write(path, contents)
  )
})

function expectExactlyTheRecordedSlot(): void {
  const active = host.activeVersion()
  expect([...host.alive]).toEqual(active ? [active] : [])
  expect(host.journal).toBeNull()
  expect(host.fence).toBe(false)
}

describe('decommissioning a managed helixd', () => {
  it('stops the active instance by request, then records that nothing serves', async () => {
    expect(await decommission()).toEqual({
      outcome: 'decommissioned',
      version: OLD,
      retirement: 'retired'
    })
    expect(currentRecord()).toMatchObject({ active: null, previous: OLD, snapshot: null })
    expectExactlyTheRecordedSlot()
    // Only instance-bound requests may stop the server; never signal a possibly reused PID.
    expect(host.commands.some((command) => command.includes('kill -TERM'))).toBe(false)
  })

  it.each([
    [{ ...idle, liveSessions: null }, 'unverifiable', 'helixd_decommission_census_unavailable'],
    [{ ...idle, liveSessions: 2 }, 'live', 'helixd_decommission_terminals_running']
  ] as const)('refuses while the census says %j', async (census, verdict, code) => {
    expect(await decommission(census)).toMatchObject({ outcome: 'refused', verdict, code })
    expect(host.alive.has(OLD)).toBe(true)
    expect(writeAtomicHelixdRemoteRecord).not.toHaveBeenCalled()
  })

  it('refuses an helixd that cannot be addressed by request', async () => {
    host.alive.clear()
    expect(await decommission()).toMatchObject({
      outcome: 'refused',
      verdict: 'unverifiable',
      code: 'helixd_managed_stop_readiness_unverifiable'
    })
    expect(writeAtomicHelixdRemoteRecord).not.toHaveBeenCalled()
  })

  it('withdraws a request helixd never acted on and keeps serving', async () => {
    host.managedStop = 'stays'
    expect(await decommission()).toMatchObject({
      outcome: 'refused',
      verdict: 'live',
      code: 'helixd_decommission_stop_withdrawn'
    })
    expect(currentRecord().active).toBe(OLD)
    expectExactlyTheRecordedSlot()
  })

  it('keeps the fence while helixd is still stopping, and recovery finishes once it exits', async () => {
    host.managedStop = 'stays-dispatched'
    expect(await decommission()).toMatchObject({
      outcome: 'refused',
      verdict: 'live',
      code: 'helixd_decommission_stop_unsettled'
    })
    expect(host.fence).toBe(true)
    expect(host.journal).not.toBeNull()
    expect(await recoverInterruptedHelixdActivation(slot)).toMatchObject({
      outcome: 'refused',
      code: 'helixd_recovery_decommission_unsettled'
    })
    host.managedStop = 'exits'
    expect(await recoverInterruptedHelixdActivation(slot)).toMatchObject({
      outcome: 'recovered',
      resolution: 'committed',
      activeVersion: null
    })
    expectExactlyTheRecordedSlot()
  })

  it.each<CrashMode>(['before', 'after'])(
    'recovers to exactly the recorded slot when interrupted at every mutation (%s)',
    async (mode) => {
      host = FakeHelixdHost.deployedOld()
      await decommission()
      const total = host.mutations
      expect(total).toBeGreaterThan(3)
      for (let crashAt = 1; crashAt <= total; crashAt += 1) {
        host = FakeHelixdHost.deployedOld()
        host.crashAt = crashAt
        host.crashMode = mode
        await decommission().catch(() => undefined)
        host.crashAt = null
        const result = await recoverInterruptedHelixdActivation(slot)
        expect(['recovered', 'none'], `mutation ${crashAt}`).toContain(result.outcome)
        expectExactlyTheRecordedSlot()
      }
    }
  )
})
