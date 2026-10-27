import { describe, expect, it } from 'vitest'
import {
  extractGitHubIssueSourceError,
  extractGitHubIssueSourceFallback
} from './github-work-item-source-errors'

describe('extractGitHubIssueSourceError', () => {
  it('keeps the failing issue source slug with the repo that produced it', () => {
    expect(
      extractGitHubIssueSourceError(
        { id: 'repo-1', path: '/work/helix' },
        {
          sources: { issues: { owner: 'upstream', repo: 'helix' } },
          errors: { issues: { message: 'HTTP 403: resource not accessible' } }
        }
      )
    ).toEqual({
      repoId: 'repo-1',
      repoPath: '/work/helix',
      source: { owner: 'upstream', repo: 'helix' },
      message: 'HTTP 403: resource not accessible'
    })
  })

  it('drops issue errors when the source slug is unavailable', () => {
    expect(
      extractGitHubIssueSourceError(
        { id: 'repo-1', path: '/work/helix' },
        {
          sources: { issues: null },
          errors: { issues: { message: 'failed' } }
        }
      )
    ).toBeNull()
  })

  it('returns null when the envelope has no issue-side error', () => {
    expect(
      extractGitHubIssueSourceError(
        { id: 'repo-1', path: '/work/helix' },
        {
          sources: { issues: { owner: 'bernardofernandezz', repo: 'helix' } }
        }
      )
    ).toBeNull()
  })
})

describe('extractGitHubIssueSourceFallback', () => {
  it('reports the repo whose upstream issue source fell back to origin', () => {
    expect(
      extractGitHubIssueSourceFallback(
        { id: 'repo-1', path: '/work/helix', displayName: 'helix' },
        {
          issueSourceFellBack: true,
          sources: {
            issues: { owner: 'bernardofernandezz', repo: 'helix-fork' },
            prs: { owner: 'bernardofernandezz', repo: 'helix' }
          }
        }
      )
    ).toEqual({
      repoId: 'repo-1',
      repoPath: '/work/helix',
      repoLabel: 'bernardofernandezz/helix'
    })
  })

  it('uses the Helix repo display name when the PR source is unavailable', () => {
    expect(
      extractGitHubIssueSourceFallback(
        { id: 'repo-1', path: '/work/helix', displayName: 'helix' },
        {
          issueSourceFellBack: true,
          sources: { issues: null, prs: null }
        }
      )
    ).toEqual({
      repoId: 'repo-1',
      repoPath: '/work/helix',
      repoLabel: 'helix'
    })
  })

  it('returns null when the source resolver did not fall back', () => {
    expect(
      extractGitHubIssueSourceFallback(
        { id: 'repo-1', path: '/work/helix', displayName: 'helix' },
        {
          sources: { issues: { owner: 'bernardofernandezz', repo: 'helix' } }
        }
      )
    ).toBeNull()
  })
})
