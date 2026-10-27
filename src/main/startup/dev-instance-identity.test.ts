import { describe, expect, it } from 'vitest'
import { getDevInstanceIdentity, shouldApplyPreReadyAppName } from './dev-instance-identity'

describe('dev-instance-identity', () => {
  it('keeps packaged identity stable', () => {
    expect(getDevInstanceIdentity(false, {})).toMatchObject({
      name: 'Helix',
      appName: 'Helix',
      isDev: false,
      devLabel: null,
      dockBadgeLabel: null,
      appUserModelId: 'com.helixbio.helix'
    })
  })

  it('pins a stable dev appName across branches so the safeStorage key does not churn', () => {
    const a = getDevInstanceIdentity(true, { HELIX_DEV_BRANCH: 'feature/a' })
    const b = getDevInstanceIdentity(true, { HELIX_DEV_BRANCH: 'feature/b' })

    expect(a.name).not.toBe(b.name)
    expect(a.appName).toBe('Helix Dev')
    expect(b.appName).toBe('Helix Dev')
    expect(a.appName).not.toBe('Helix')
  })

  it('never renames a packaged build before ready', () => {
    // Packaged forks must retain their CFBundleName-derived safeStorage key or encrypted secrets become orphaned.
    expect(shouldApplyPreReadyAppName(getDevInstanceIdentity(false, {}))).toBe(false)
    expect(shouldApplyPreReadyAppName({ isDev: false })).toBe(false)
  })

  it('applies the dev name before ready so safeStorage sees it', () => {
    expect(shouldApplyPreReadyAppName(getDevInstanceIdentity(true, {}))).toBe(true)
  })

  it('derives a readable dev label from worktree and branch env', () => {
    const identity = getDevInstanceIdentity(true, {
      HELIX_DEV_REPO_ROOT: '/repo/worktrees/dev-indicator',
      HELIX_DEV_WORKTREE_NAME: 'dev-indicator',
      HELIX_DEV_BRANCH: 'nwparker/dev-indicator'
    })

    expect(identity).toMatchObject({
      isDev: true,
      devLabel: 'dev-indicator',
      devBranch: 'nwparker/dev-indicator',
      devWorktreeName: 'dev-indicator',
      devRepoRoot: '/repo/worktrees/dev-indicator'
    })
    expect(identity.name).toBe('Helix: nwparker/dev-indicator')
    expect(identity.dockBadgeLabel).toBeNull()
    expect(identity.appUserModelId).toMatch(/^com\.helixbio\.helix\.dev\.[a-f0-9]{10}$/)
  })

  it('includes the branch when it differs from the worktree basename', () => {
    const identity = getDevInstanceIdentity(true, {
      HELIX_DEV_REPO_ROOT: '/repo/worktrees/payment-ui',
      HELIX_DEV_WORKTREE_NAME: 'payment-ui',
      HELIX_DEV_BRANCH: 'feature/billing-shell'
    })

    expect(identity.devLabel).toBe('payment-ui @ feature/billing-shell')
    expect(identity.name).toBe('Helix: feature/billing-shell')
    expect(identity.dockBadgeLabel).toBeNull()
  })

  it('allows an explicit label override', () => {
    const identity = getDevInstanceIdentity(true, {
      HELIX_DEV_INSTANCE_LABEL: 'manual label',
      HELIX_DEV_WORKTREE_NAME: 'dev-indicator',
      HELIX_DEV_BRANCH: 'feature/other'
    })

    expect(identity.devLabel).toBe('manual label')
    expect(identity.name).toBe('Helix: feature/other')
    expect(identity.dockBadgeLabel).toBeNull()
  })
})
