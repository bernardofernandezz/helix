import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isManagedHelixdSshTarget,
  isRuntimeOwnedSshTarget,
  SshConnectionStore
} from './ssh-connection-store'
import { createMockStore } from './ssh-connection-store-test-fixture'
import { emptyDependentStateStore } from '../targets/ssh-target-helixd-dependents-fixture'

const { loadUserSshConfigMock, sshConfigHostsToTargetsMock } = vi.hoisted(() => ({
  loadUserSshConfigMock: vi.fn(),
  sshConfigHostsToTargetsMock: vi.fn()
}))

vi.mock('../config/ssh-config-parser', () => ({
  loadUserSshConfig: loadUserSshConfigMock,
  sshConfigHostsToTargets: sshConfigHostsToTargetsMock
}))

const base = { label: 'cluster', host: 'cluster.example.com', port: 22, username: 'dev' }

describe('managed helixd ownership of SSH targets', () => {
  let mockStore: ReturnType<typeof createMockStore>
  let sshStore: SshConnectionStore

  beforeEach(() => {
    mockStore = Object.assign(createMockStore(), emptyDependentStateStore())
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture implements the store methods SshConnectionStore calls.
    sshStore = new SshConnectionStore(mockStore as never)
    loadUserSshConfigMock.mockReset()
    sshConfigHostsToTargetsMock.mockReset()
  })

  it('lists managed and provisioning hosts with their status, and hides only runtime-owned ones', () => {
    sshStore.addTarget(base)
    sshStore.addTarget({
      ...base,
      label: 'provisioning',
      helixdProvisioning: { requestId: 'r', name: 'n' }
    })
    const claimed = sshStore.addTarget({ ...base, label: 'claimed' })
    sshStore.getHelixdRuntimeClaims().claim(claimed.id, 'environment-1', { ownerRecorded: false })
    mockStore.addSshTarget({
      ...base,
      id: 'runtime-ssh-vm',
      label: 'vm',
      owner: { type: 'on-demand-runtime', runtimeId: 'vm-1' }
    })

    expect(sshStore.listTargets().map((target) => target.label)).toEqual([
      'cluster',
      'provisioning',
      'claimed'
    ])
    expect(sshStore.getTarget(claimed.id)?.owner).toBeUndefined()
  })

  it('keeps ~/.ssh/config sync from rewriting a claimed config-sourced host', () => {
    mockStore.addSshTarget({
      ...base,
      id: 'ssh-config-host',
      configHost: 'cluster',
      source: 'ssh-config',
      helixdFence: { environmentId: 'environment-1' }
    })
    loadUserSshConfigMock.mockReturnValue([{ host: 'cluster' }])
    sshConfigHostsToTargetsMock.mockReturnValue([
      { ...base, id: 'tmp', configHost: 'cluster', host: '10.0.0.9', port: 2222 }
    ])

    expect(sshStore.importFromSshConfig()).toEqual([])
    expect(mockStore.updateSshTarget).not.toHaveBeenCalled()
  })

  it('tells a managed host apart from a runtime-owned one', () => {
    const target = { ...base, id: 'ssh-1' }
    const provisioning = { ...target, helixdProvisioning: { requestId: 'r', name: 'n' } }
    const fenced = { ...target, helixdFence: { environmentId: 'e' } }
    expect(isManagedHelixdSshTarget(target)).toBe(false)
    expect(isManagedHelixdSshTarget(provisioning)).toBe(true)
    expect(isManagedHelixdSshTarget(fenced)).toBe(true)
    expect(isRuntimeOwnedSshTarget(fenced)).toBe(false)
    expect(
      isRuntimeOwnedSshTarget({ ...target, owner: { type: 'on-demand-runtime', runtimeId: 'vm' } })
    ).toBe(true)
  })
})
