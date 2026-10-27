import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  deriveAiVaultScopeSessionPaths,
  deriveAiVaultWorkspaceScopePaths
} from './ai-vault-scope-paths'

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: 'repo-1::/repo/helix',
    repoId: 'repo-1',
    displayName: 'helix',
    path: '/repo/helix',
    head: 'abc123',
    branch: 'main',
    isBare: false,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    isMainWorktree: false,
    ...overrides
  }
}

describe('deriveAiVaultWorkspaceScopePaths', () => {
  it('returns the active workspace path', () => {
    const active = makeWorktree()
    expect(deriveAiVaultWorkspaceScopePaths(active, [active])).toEqual(['/repo/helix'])
  })

  it('returns nothing without an active workspace', () => {
    expect(deriveAiVaultWorkspaceScopePaths(null, [makeWorktree()])).toEqual([])
  })

  it('includes prior paths so renamed workspaces keep their transcripts', () => {
    const active = makeWorktree({
      id: 'repo-1::/repo/helix-renamed',
      path: '/repo/helix-renamed',
      priorWorktreeIds: ['repo-1::/repo/helix']
    })

    expect(deriveAiVaultWorkspaceScopePaths(active, [active])).toEqual([
      '/repo/helix-renamed',
      '/repo/helix'
    ])
  })

  it('drops a prior path another live workspace now owns', () => {
    // Sessions use cwd identity; claiming an occupied prior path would expose another workspace's transcripts.
    const claimant = makeWorktree({ id: 'repo-1::/repo/helix', path: '/repo/helix' })
    const active = makeWorktree({
      id: 'repo-1::/repo/helix-renamed',
      path: '/repo/helix-renamed',
      priorWorktreeIds: ['repo-1::/repo/helix']
    })

    expect(deriveAiVaultWorkspaceScopePaths(active, [claimant, active])).toEqual([
      '/repo/helix-renamed'
    ])
  })

  it('keeps a prior path the active workspace itself still owns', () => {
    const active = makeWorktree({ priorWorktreeIds: ['repo-1::/repo/helix'] })
    expect(deriveAiVaultWorkspaceScopePaths(active, [active])).toEqual(['/repo/helix'])
  })

  it('drops a claimed prior path regardless of where the claimant sits in the list', () => {
    // Exclude the active workspace before indexing owners so duplicates cannot hide later claimants.
    const active = makeWorktree({
      id: 'repo-1::/repo/helix-renamed',
      path: '/repo/helix-renamed',
      priorWorktreeIds: ['repo-1::/repo/helix']
    })
    const claimant = makeWorktree({ id: 'repo-1::/repo/helix', path: '/repo/helix' })
    // Listing the active workspace at the prior path exposes first-writer-wins ownership bugs.
    const activeAtPriorPath = makeWorktree({ id: active.id, path: '/repo/helix' })

    for (const liveWorktrees of [
      [active, claimant],
      [claimant, active],
      [activeAtPriorPath, claimant],
      [claimant, activeAtPriorPath]
    ]) {
      expect(deriveAiVaultWorkspaceScopePaths(active, liveWorktrees)).toEqual([
        '/repo/helix-renamed'
      ])
    }
  })

  it('derives workspace scope paths at scale', () => {
    // The session-scope guard cannot catch quadratic deduplication confined to the workspace pass.
    const prefix = '/Users/dev/helix/workspaces/helix-monorepo/feature-'
    const worktrees = Array.from({ length: 1200 }, (_, i) =>
      makeWorktree({ id: `repo-1::${prefix}${i}`, path: `${prefix}${i}` })
    )
    const active = makeWorktree({
      id: `repo-1::${prefix}0`,
      path: `${prefix}0`,
      // Priors drive the claim check, which is the other per-call scan here.
      priorWorktreeIds: Array.from({ length: 25 }, (_, i) => `repo-1::${prefix}prior-${i}`)
    })

    const startedAt = performance.now()
    const paths = deriveAiVaultWorkspaceScopePaths(active, worktrees)
    const elapsedMs = performance.now() - startedAt

    expect(paths).toHaveLength(1 + 25)
    expect(elapsedMs).toBeLessThan(100)
  })

  it('ignores prior ids belonging to another repo', () => {
    const active = makeWorktree({ priorWorktreeIds: ['repo-2::/repo/other'] })
    expect(deriveAiVaultWorkspaceScopePaths(active, [active])).toEqual(['/repo/helix'])
  })

  it('skips relative and blank paths', () => {
    const active = makeWorktree({ path: 'relative/path' })
    expect(deriveAiVaultWorkspaceScopePaths(active, [active])).toEqual([])
    expect(deriveAiVaultWorkspaceScopePaths(makeWorktree({ path: '   ' }), [])).toEqual([])
  })
})

describe('deriveAiVaultScopeSessionPaths', () => {
  it('covers the active workspace plus the rest of its repo', () => {
    const active = makeWorktree()
    const sibling = makeWorktree({ id: 'repo-1::/repo/feature', path: '/repo/feature' })
    const otherRepo = makeWorktree({
      id: 'repo-2::/repo/other',
      repoId: 'repo-2',
      path: '/repo/other'
    })

    expect(deriveAiVaultScopeSessionPaths(active, [active, sibling, otherRepo])).toEqual([
      '/repo/helix',
      '/repo/feature'
    ])
  })

  it('deduplicates paths that differ only by separators or trailing slash', () => {
    // The dedupe compares normalized keys; the first spelling is what ships.
    const active = makeWorktree()
    const trailing = makeWorktree({ id: 'repo-1::a', path: '/repo/helix/' })
    const doubled = makeWorktree({ id: 'repo-1::b', path: '/repo//helix' })

    expect(deriveAiVaultScopeSessionPaths(active, [active, trailing, doubled])).toEqual([
      '/repo/helix'
    ])
  })

  it('treats NFD and NFC spellings of one path as the same scope entry', () => {
    // macOS yields NFD on disk while agents record NFC cwds.
    const nfc = '/repo/프로젝트'
    const active = makeWorktree({ id: `repo-1::${nfc}`, path: nfc })
    const nfd = makeWorktree({ id: 'repo-1::nfd', path: nfc.normalize('NFD') })

    expect(deriveAiVaultScopeSessionPaths(active, [active, nfd])).toEqual([nfc])
  })

  it('derives scope paths at scale without re-normalizing the accumulator', () => {
    // Match profile count/path lengths to catch quadratic normalization on workspace switches (~190ms before).
    const prefix = '/Users/dev/helix/workspaces/helix-monorepo/feature-'
    const worktrees = Array.from({ length: 1200 }, (_, i) =>
      makeWorktree({ id: `repo-1::${prefix}${i}`, path: `${prefix}${i}` })
    )

    const startedAt = performance.now()
    const paths = deriveAiVaultScopeSessionPaths(worktrees[0], worktrees)
    const elapsedMs = performance.now() - startedAt

    expect(paths).toHaveLength(worktrees.length)
    // Allow slow CI hosts while catching the previous ~190ms cost (now ~1ms).
    expect(elapsedMs).toBeLessThan(100)
  })
})
