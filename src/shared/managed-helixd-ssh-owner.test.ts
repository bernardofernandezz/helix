import { describe, expect, it } from 'vitest'
import {
  getLegacyManagedHelixdOwnerEnvironmentId,
  getManagedHelixdFenceEnvironmentId,
  isEphemeralRuntimeSshOwner,
  managedHelixdServerName
} from './managed-helixd-ssh-owner'

describe('managed helixd SSH fence', () => {
  it('reads the fence from helixdFence, never from owner', () => {
    expect(getManagedHelixdFenceEnvironmentId({ helixdFence: { environmentId: 'env-1' } })).toBe(
      'env-1'
    )
    const legacyOnly = {
      helixdFence: undefined,
      owner: { type: 'on-demand-runtime' as const, runtimeId: 'managed-helixd:old' }
    }
    expect(getManagedHelixdFenceEnvironmentId({ ...legacyOnly })).toBeNull()
    expect(
      getManagedHelixdFenceEnvironmentId({ ...legacyOnly, helixdFence: { environmentId: 'env-2' } })
    ).toBe('env-2')
    expect(getManagedHelixdFenceEnvironmentId(undefined)).toBeNull()
  })

  it('recognises the legacy owner fence only so loading can migrate it', () => {
    const legacy = { type: 'on-demand-runtime' as const, runtimeId: 'managed-helixd:env-1' }
    expect(getLegacyManagedHelixdOwnerEnvironmentId(legacy)).toBe('env-1')
    expect(isEphemeralRuntimeSshOwner(legacy)).toBe(false)
  })

  it('keeps ordinary on-demand runtime targets ephemeral', () => {
    const owner = { type: 'on-demand-runtime' as const, runtimeId: 'runtime-1' }
    expect(getLegacyManagedHelixdOwnerEnvironmentId(owner)).toBeNull()
    expect(isEphemeralRuntimeSshOwner(owner)).toBe(true)
  })

  it("names a recipe VM's server after its runtime, so two VMs of one recipe never collide", () => {
    const owner = { type: 'on-demand-runtime' as const, runtimeId: 'runtime-0123456789abcdef' }
    expect(managedHelixdServerName({ label: 'Docker root', owner })).toBe('Docker root VM 89abcdef')
    expect(
      managedHelixdServerName({
        label: 'Docker root',
        owner: { ...owner, runtimeId: 'runtime-fedcba9876543210' }
      })
    ).toBe('Docker root VM 76543210')
    expect(managedHelixdServerName({ label: 'Builder' })).toBe('Builder')
  })
})
