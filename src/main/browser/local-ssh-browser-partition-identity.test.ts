import { describe, expect, it } from 'vitest'
import { sshExecutionHostStorageIdentity } from './browser-execution-host-storage-identity'
import {
  deriveBrowserRoutePartition,
  deriveBrowserRoutePartitionStorageScope,
  deriveLocalSshBrowserRoutePartitionStorageScope
} from './browser-route-identity'
import { localSshBrowserAuthorityConnectionIdentity } from './local-ssh-browser-partitions'

function derive(helixProfileId: string, browserProfileId: string, targetId: string) {
  return deriveBrowserRoutePartition({
    helixProfileId,
    browserProfileId,
    authorityConnectionIdentity: localSshBrowserAuthorityConnectionIdentity(helixProfileId),
    executionHostIdentity: sshExecutionHostStorageIdentity(targetId)
  })
}

describe('local ssh browser partition identity', () => {
  it('pins the golden partition so no per-boot value can sneak into the name', () => {
    // Changing this cookie-storage identity requires a migration.
    expect(derive('local-default', 'default', 'ssh-target-1').partition).toBe(
      'persist:helix-browser-v1-9c13f4dfb9158d95c085a6e56c3da418751d014588f75034cce52a2f89b1ff41'
    )
  })

  it('derives one stable partition per (profile, target) and separates each axis', () => {
    const base = derive('local-default', 'default', 'ssh-target-1')
    expect(derive('local-default', 'default', 'ssh-target-1')).toEqual(base)
    expect(derive('local-default', 'default', 'ssh-target-2').partition).not.toBe(base.partition)
    expect(derive('local-default', 'session-a', 'ssh-target-1').partition).not.toBe(base.partition)
    expect(derive('profile-b', 'default', 'ssh-target-1').partition).not.toBe(base.partition)
  })

  it('separates the local-ssh storage scope domain from environment scopes', () => {
    expect(
      deriveLocalSshBrowserRoutePartitionStorageScope({
        helixProfileId: 'local-default',
        targetId: 'same-id'
      })
    ).not.toBe(
      deriveBrowserRoutePartitionStorageScope({
        helixProfileId: 'local-default',
        environmentId: 'same-id'
      })
    )
  })

  it('keeps the storage identity aligned with the paired nested-SSH identity', () => {
    expect(sshExecutionHostStorageIdentity('t-1')).toBe(
      '["helix-browser-execution-host-storage",1,"ssh","t-1"]'
    )
  })
})
