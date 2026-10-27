import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getManagedHelixdFenceEnvironmentId } from '../../../shared/managed-helixd-ssh-owner'
import { listEnvironments } from '../../../shared/runtime-environment-store'
import {
  listHelixdMigrationSourceCutovers,
  writeHelixdMigrationSourceCutover
} from '../../ssh/helixd-migration-cutover-journal'
import { helixdMigrationCutoverFixture } from '../../ssh/helixd-migration-cutover-fixture'
import { createManagedLifecycleHarness } from './helixd-managed-lifecycle-test-fixture'
import { isManagedHelixdSshTarget } from '../../ssh/connection/ssh-connection-store'

const mocks = vi.hoisted(() => {
  const state: { store: unknown } = { store: null }
  return {
    state,
    connect: vi.fn(),
    resolveContext: vi.fn(),
    closeTunnel: vi.fn(),
    retire: vi.fn()
  }
})

vi.mock('../../ssh/targets/ssh-target-registry', () => ({
  getSshConnectionManager: () => ({ connect: mocks.connect }),
  getSshTargetRegistryStore: () => mocks.state.store
}))
vi.mock('../install/helixd-remote-context', () => ({
  resolveHelixdRemoteContext: mocks.resolveContext
}))
vi.mock('./helixd-managed-tunnel', () => ({
  closeHelixdManagedTunnel: mocks.closeTunnel,
  ensureHelixdManagedTunnel: vi.fn()
}))

const { forgetManagedHelixdEnvironment, stopManagedHelixdEnvironment } =
  await import('./helixd-runtime-decommission')

let harness: ReturnType<typeof createManagedLifecycleHarness>

const policy = (isActive = false) => ({
  isActiveEnvironment: () => isActive,
  retireLocalState: mocks.retire
})

beforeEach(() => {
  vi.resetAllMocks()
  harness = createManagedLifecycleHarness()
  mocks.state.store = harness.targetStore
  mocks.connect.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:2841'))
  mocks.resolveContext.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:2841'))
})

afterEach(() => rmSync(harness.userDataPath, { recursive: true, force: true }))

describe('a managed server whose host is gone (P1-E)', () => {
  it('cannot be stopped, since the host can never prove helixd exited', async () => {
    await expect(
      stopManagedHelixdEnvironment(harness.userDataPath, { selector: 'Managed' }, policy())
    ).rejects.toThrow('ECONNREFUSED')
    expect(listEnvironments(harness.userDataPath)).toHaveLength(1)
    expect(isManagedHelixdSshTarget(harness.current())).toBe(true)
  })

  it('is forgotten locally without contacting the host, which frees its SSH target', async () => {
    writeHelixdMigrationSourceCutover(harness.userDataPath, {
      ...helixdMigrationCutoverFixture('migration-1', 'ssh-1', { environmentId: 'environment-1' }),
      phase: 'destination-committed',
      sourceRetainedAt: '2026-10-01T00:00:00.000Z'
    })
    await expect(
      forgetManagedHelixdEnvironment(harness.userDataPath, { selector: 'Managed' }, policy())
    ).resolves.toEqual({
      outcome: 'forgotten',
      // No host observation means local forgetting cannot report proven exit.
      verdict: 'unverifiable',
      environmentId: 'environment-1',
      sshTargetId: 'ssh-1'
    })
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.resolveContext).not.toHaveBeenCalled()
    expect(listEnvironments(harness.userDataPath)).toEqual([])
    expect(getManagedHelixdFenceEnvironmentId(harness.current())).toBeNull()
    expect(isManagedHelixdSshTarget(harness.current())).toBe(false)
    expect(harness.flushes).toHaveLength(1)
    expect(mocks.retire).toHaveBeenCalledWith('environment-1')
    expect(mocks.closeTunnel).toHaveBeenCalledWith('environment-1')
    expect(listHelixdMigrationSourceCutovers(harness.userDataPath)).toEqual([])
  })

  it('refuses to forget the Active Server and keeps every link', async () => {
    await expect(
      forgetManagedHelixdEnvironment(harness.userDataPath, { selector: 'Managed' }, policy(true))
    ).resolves.toMatchObject({ outcome: 'refused', code: 'helixd_forget_active_environment' })
    expect(listEnvironments(harness.userDataPath)).toHaveLength(1)
    expect(getManagedHelixdFenceEnvironmentId(harness.current())).toBe('environment-1')
    expect(mocks.retire).not.toHaveBeenCalled()
    expect(mocks.closeTunnel).not.toHaveBeenCalled()
  })
})
