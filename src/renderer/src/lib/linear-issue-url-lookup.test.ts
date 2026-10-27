import { describe, expect, it, vi } from 'vitest'
import type { LinearIssue } from '../../../shared/linear/issue-types'
import type { LinearConnectionStatus } from '../../../shared/linear/workspace-types'
import { lookupLinearIssueUrl } from './linear-issue-url-lookup'

const intent = { identifier: 'BIO-4084', organizationUrlKey: 'bernardofernandezz' }

function issue(organizationUrlKey = 'bernardofernandezz'): LinearIssue {
  return {
    id: `${organizationUrlKey}-issue`,
    workspaceId: `${organizationUrlKey}-workspace`,
    workspaceName: organizationUrlKey,
    identifier: 'BIO-4084',
    title: 'Restore shell integration',
    url: `https://linear.app/${organizationUrlKey}/issue/BIO-4084/restore-shell-integration`,
    state: { name: 'Todo', type: 'unstarted', color: '#999999' },
    team: { id: 'team-bio', name: 'Acme', key: 'BIO' },
    labels: [],
    labelIds: [],
    priority: 2,
    updatedAt: '2026-08-12T00:00:00.000Z'
  }
}

describe('Linear issue URL lookup', () => {
  it('uses the known workspace named by the URL', async () => {
    const fetchLinearIssue = vi.fn(async () => issue())
    const readLinearStatus = vi.fn<() => Promise<LinearConnectionStatus>>()

    await expect(
      lookupLinearIssueUrl({
        intent,
        knownStatus: {
          viewer: null,
          workspaces: [
            {
              id: 'bernardofernandezz-workspace',
              organizationUrlKey: 'bernardofernandezz'
            } as never
          ]
        },
        sourceContext: null,
        fetchLinearIssue,
        readLinearStatus
      })
    ).resolves.toMatchObject({ identifier: 'BIO-4084' })
    expect(fetchLinearIssue).toHaveBeenCalledWith('BIO-4084', 'bernardofernandezz-workspace', {
      sourceContext: null
    })
    expect(readLinearStatus).not.toHaveBeenCalled()
  })

  it('refreshes status from the source owner when the known workspace is stale', async () => {
    const fetchLinearIssue = vi.fn(async (_identifier: string, workspaceId?: string | null) =>
      workspaceId === 'remote-bernardofernandezz-workspace' ? issue() : null
    )

    await expect(
      lookupLinearIssueUrl({
        intent,
        knownStatus: {
          viewer: null,
          workspaces: [{ id: 'stale-workspace', organizationUrlKey: 'bernardofernandezz' } as never]
        },
        sourceContext: null,
        fetchLinearIssue,
        readLinearStatus: async () => ({
          connected: true,
          viewer: null,
          workspaces: [
            {
              id: 'remote-bernardofernandezz-workspace',
              organizationUrlKey: 'bernardofernandezz'
            } as never
          ]
        })
      })
    ).resolves.toMatchObject({ workspaceId: 'bernardofernandezz-workspace' })
    expect(fetchLinearIssue).toHaveBeenCalledTimes(2)
  })

  it('uses legacy viewer status when mixed versions omit the workspace list', async () => {
    const fetchLinearIssue = vi.fn(async () => issue())

    await expect(
      lookupLinearIssueUrl({
        intent,
        knownStatus: {
          viewer: {
            displayName: 'Linear User',
            email: null,
            organizationName: 'Acme',
            organizationUrlKey: 'bernardofernandezz'
          },
          activeWorkspaceId: 'legacy-workspace'
        },
        sourceContext: null,
        fetchLinearIssue,
        readLinearStatus: vi.fn()
      })
    ).resolves.toMatchObject({ identifier: 'BIO-4084' })
    expect(fetchLinearIssue).toHaveBeenCalledWith('BIO-4084', 'legacy-workspace', {
      sourceContext: null
    })
  })

  it('probes a legacy workspace that omitted its organization URL key', async () => {
    const fetchLinearIssue = vi.fn(async () => issue())

    await expect(
      lookupLinearIssueUrl({
        intent,
        knownStatus: {
          viewer: {
            displayName: 'Linear User',
            email: null,
            organizationName: 'Saved Linear workspace'
          },
          activeWorkspaceId: 'legacy',
          selectedWorkspaceId: 'legacy',
          workspaces: [{ id: 'legacy', organizationName: 'Saved Linear workspace' } as never]
        },
        sourceContext: null,
        fetchLinearIssue,
        readLinearStatus: vi.fn()
      })
    ).resolves.toMatchObject({ identifier: 'BIO-4084' })
    expect(fetchLinearIssue).toHaveBeenCalledWith('BIO-4084', 'legacy', {
      sourceContext: null
    })
  })

  it('does not fall back to an all-workspaces lookup that can collide across organizations', async () => {
    const fetchLinearIssue = vi.fn(async () => issue('other'))

    await expect(
      lookupLinearIssueUrl({
        intent,
        knownStatus: {
          viewer: null,
          workspaces: [{ id: 'other-workspace', organizationUrlKey: 'other' } as never]
        },
        sourceContext: null,
        fetchLinearIssue,
        readLinearStatus: async () => ({
          connected: true,
          viewer: null,
          workspaces: [{ id: 'other-workspace', organizationUrlKey: 'other' } as never]
        })
      })
    ).resolves.toBeNull()
    expect(fetchLinearIssue).not.toHaveBeenCalled()
  })
})
