import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinearWorkspace } from '../../../shared/linear/workspace-types'

const { connectedWorkspaces } = vi.hoisted(() => ({
  connectedWorkspaces: [] as LinearWorkspace[]
}))

vi.mock('./client', () => ({
  getConnectedWorkspaces: () => connectedWorkspaces
}))

import { getLinearCurrentIssueFromWorktree, resolveLegacyLinearLinkWorkspace } from './current'

describe('linear issue current worktree link resolution', () => {
  beforeEach(() => {
    connectedWorkspaces.length = 0
  })

  it('uses split organization URL key metadata from CLI-created Linear links', () => {
    const link = getLinearCurrentIssueFromWorktree({
      id: 'repo::/tmp/worktree',
      path: '/tmp/worktree',
      linkedLinearIssue: 'bio-335',
      linkedLinearIssueWorkspaceId: null,
      linkedLinearIssueOrganizationUrlKey: 'bernardofernandezz'
    })

    expect(link).toMatchObject({
      identifier: 'BIO-335',
      workspaceId: null,
      organizationUrlKey: 'bernardofernandezz',
      worktreeId: 'repo::/tmp/worktree'
    })
  })

  it('backfills workspace id from split organization URL key metadata', () => {
    connectedWorkspaces.push(
      makeWorkspace('workspace-1', 'bernardofernandezz'),
      makeWorkspace('workspace-2', 'acme')
    )

    expect(resolveLegacyLinearLinkWorkspace('BIO-335', 'bernardofernandezz')).toEqual({
      workspaceId: 'workspace-1',
      organizationUrlKey: 'bernardofernandezz'
    })
  })

  it('keeps ambiguous split organization URL key backfill workspace-free', () => {
    connectedWorkspaces.push(
      makeWorkspace('workspace-1', 'bernardofernandezz'),
      makeWorkspace('workspace-2', 'bernardofernandezz')
    )

    expect(resolveLegacyLinearLinkWorkspace('BIO-335', 'bernardofernandezz')).toEqual({
      organizationUrlKey: 'bernardofernandezz'
    })
  })
})

function makeWorkspace(id: string, organizationUrlKey: string): LinearWorkspace {
  return {
    id,
    organizationId: id,
    organizationName: organizationUrlKey,
    organizationUrlKey,
    displayName: organizationUrlKey,
    email: `${id}@example.com`
  }
}
