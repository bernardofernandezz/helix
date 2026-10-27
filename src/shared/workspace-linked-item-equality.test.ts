import { describe, expect, it } from 'vitest'
import { areWorkspaceLinkedItemsEqual } from './workspace-linked-item'
import type { WorkspaceLinkedItem } from './worktree/types'

const item: WorkspaceLinkedItem = {
  provider: 'jira',
  type: 'issue',
  number: 0,
  title: 'HELIX-123 Link Jira',
  url: 'https://company.atlassian.net/browse/HELIX-123',
  jiraIdentifier: 'HELIX-123',
  repoId: 'repo-1'
}

describe('areWorkspaceLinkedItemsEqual', () => {
  it('ignores key order and absent-vs-undefined optional fields', () => {
    expect(
      areWorkspaceLinkedItemsEqual(item, {
        repoId: 'repo-1',
        jiraIdentifier: 'HELIX-123',
        url: 'https://company.atlassian.net/browse/HELIX-123',
        title: 'HELIX-123 Link Jira',
        number: 0,
        type: 'issue',
        provider: 'jira',
        linearIdentifier: undefined
      })
    ).toBe(true)
  })

  it('separates items that differ by identifier, title, url, provider, or repo', () => {
    expect(areWorkspaceLinkedItemsEqual(item, { ...item, jiraIdentifier: 'HELIX-124' })).toBe(false)
    expect(areWorkspaceLinkedItemsEqual(item, { ...item, title: 'Renamed' })).toBe(false)
    expect(areWorkspaceLinkedItemsEqual(item, { ...item, url: 'https://other/browse/X-1' })).toBe(
      false
    )
    expect(areWorkspaceLinkedItemsEqual(item, { ...item, provider: 'github', number: 12 })).toBe(
      false
    )
    expect(areWorkspaceLinkedItemsEqual(item, { ...item, repoId: 'repo-2' })).toBe(false)
  })
})
