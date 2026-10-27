import { describe, expect, it } from 'vitest'
import {
  findLinearIssueWorkspaceId,
  findLinearIssueWorkspaceLookupIds,
  isLinearIssueUrlResolutionMatch,
  parseLinearIssueUrlIntent
} from '../../../shared/linear/links'

describe('Cmd+J Linear issue intent', () => {
  it('accepts canonical Linear issue URLs with optional slugs', () => {
    expect(
      parseLinearIssueUrlIntent(
        'https://linear.app/bernardofernandezz/issue/BIO-4052/agent-terminals-disappearing-randomly'
      )
    ).toEqual({ identifier: 'BIO-4052', organizationUrlKey: 'bernardofernandezz' })
    expect(
      parseLinearIssueUrlIntent(
        ' https://linear.app/bernardofernandezz/issue/bio-4084/restore-shell-integration '
      )
    ).toEqual({ identifier: 'BIO-4084', organizationUrlKey: 'bernardofernandezz' })
    expect(parseLinearIssueUrlIntent('http://linear.app/acme/issue/ENG-1')).toEqual({
      identifier: 'ENG-1',
      organizationUrlKey: 'acme'
    })
  })

  it('does not classify names, bare issue keys, or ambiguous URLs as decisive intent', () => {
    expect(parseLinearIssueUrlIntent('restore-shell-integration')).toBeNull()
    expect(parseLinearIssueUrlIntent('BIO-4084')).toBeNull()
    expect(
      parseLinearIssueUrlIntent('https://linear.app/bernardofernandezz/team/BIO/all')
    ).toBeNull()
    expect(
      parseLinearIssueUrlIntent('https://linear.app.evil.test/bernardofernandezz/issue/BIO-4084')
    ).toBeNull()
    expect(parseLinearIssueUrlIntent('https://linear.app/foo/bar/issue/BIO-4084')).toBeNull()
    expect(
      parseLinearIssueUrlIntent(
        'https://linear.app/bernardofernandezz/issue/BIO-4084/title/activity'
      )
    ).toBeNull()
    expect(
      parseLinearIssueUrlIntent(
        'https://linear.app/bernardofernandezz/issue/BIO-4084%2Fnot-the-identifier'
      )
    ).toBeNull()
    expect(
      parseLinearIssueUrlIntent('https://user@linear.app/bernardofernandezz/issue/BIO-4084/title')
    ).toBeNull()
  })

  it('targets the workspace named by the URL before falling back to all workspaces', () => {
    const intent = { identifier: 'BIO-4084', organizationUrlKey: 'bernardofernandezz' }
    const workspaces = [
      { id: 'workspace-other', organizationUrlKey: 'other' },
      { id: 'workspace-bernardofernandezz', organizationUrlKey: 'BernardoFernandezz' }
    ]

    expect(findLinearIssueWorkspaceId(intent, workspaces)).toBe('workspace-bernardofernandezz')
    expect(findLinearIssueWorkspaceId(intent, workspaces.slice(0, 1))).toBeNull()
    expect(findLinearIssueWorkspaceId(intent, undefined)).toBeNull()
  })

  it('includes legacy workspaces that omitted their organization URL key', () => {
    const intent = { identifier: 'BIO-4052', organizationUrlKey: 'bernardofernandezz' }

    expect(
      findLinearIssueWorkspaceLookupIds(intent, {
        viewer: {
          displayName: 'Linear User',
          email: null,
          organizationName: 'Saved Linear workspace'
        },
        activeWorkspaceId: 'legacy',
        selectedWorkspaceId: 'legacy',
        workspaces: [{ id: 'legacy' } as never]
      })
    ).toEqual(['legacy'])
    expect(
      findLinearIssueWorkspaceLookupIds(intent, {
        viewer: null,
        workspaces: [{ id: 'other-workspace', organizationUrlKey: 'other' } as never]
      })
    ).toEqual([])
  })

  it('rejects a lookup from a different identifier or known Linear organization', () => {
    const intent = { identifier: 'BIO-4084', organizationUrlKey: 'bernardofernandezz' }

    expect(
      isLinearIssueUrlResolutionMatch(intent, {
        identifier: 'BIO-4084',
        url: 'https://linear.app/bernardofernandezz/issue/BIO-4084/title'
      })
    ).toBe(true)
    expect(
      isLinearIssueUrlResolutionMatch(intent, {
        identifier: 'BIO-9999',
        url: 'https://linear.app/bernardofernandezz/issue/BIO-9999/title'
      })
    ).toBe(false)
    expect(
      isLinearIssueUrlResolutionMatch(intent, {
        identifier: 'BIO-4084',
        url: 'https://linear.app/other/issue/BIO-4084/title'
      })
    ).toBe(false)
  })

  it('rejects a matching identifier when the result URL has no usable organization key', () => {
    expect(
      isLinearIssueUrlResolutionMatch(
        { identifier: 'BIO-4084', organizationUrlKey: 'bernardofernandezz' },
        { identifier: 'BIO-4084', url: 'https://linear.example.test/BIO-4084' }
      )
    ).toBe(false)
  })
})
