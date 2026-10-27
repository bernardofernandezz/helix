import { describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { Project, ProjectHostSetup } from '../../../shared/project-types'
import type { Repo } from '../../../shared/repo-types'
import {
  resolveWorkspaceCreationRepoId,
  resolveWorkspaceCreationTarget
} from './project-host-workspace-target'

function makeRepo(id: string, overrides: Partial<Repo> = {}): Repo {
  return {
    id,
    path: `/repos/${id}`,
    displayName: id,
    badgeColor: '#000000',
    addedAt: 1,
    ...overrides
  }
}

function makeProject(
  id: string,
  sourceRepoIds: string[],
  overrides: Partial<Project> = {}
): Project {
  return {
    id,
    displayName: id,
    badgeColor: '#000000',
    sourceRepoIds,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function makeSetup(
  id: string,
  projectId: string,
  hostId: ExecutionHostId,
  repoId: string,
  overrides: Partial<ProjectHostSetup> = {}
): ProjectHostSetup {
  return {
    id,
    projectId,
    hostId,
    repoId,
    path: `/repos/${repoId}`,
    displayName: repoId,
    setupState: 'ready',
    setupMethod: 'legacy-repo',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('project-host workspace target resolution', () => {
  it('falls back to a local setup for a local-only repo', () => {
    const repo = makeRepo('helix')

    const resolution = resolveWorkspaceCreationTarget({ eligibleRepos: [repo] })

    expect(resolution).toMatchObject({
      status: 'ready',
      target: {
        projectId: 'repo:helix',
        hostId: 'local',
        projectHostSetupId: 'helix',
        repoId: 'helix'
      }
    })
  })

  it('chooses the focused host setup when one project exists on multiple hosts', () => {
    const repos = [makeRepo('helix-local'), makeRepo('helix-ssh', { connectionId: 'openclaw-2' })]
    const projects = [makeProject('github:bernardofernandezz/helix', ['helix-local', 'helix-ssh'])]
    const projectHostSetups = [
      makeSetup('helix-local', 'github:bernardofernandezz/helix', 'local', 'helix-local'),
      makeSetup('helix-ssh', 'github:bernardofernandezz/helix', 'ssh:openclaw-2', 'helix-ssh')
    ]

    expect(
      resolveWorkspaceCreationRepoId({
        eligibleRepos: repos,
        projects,
        projectHostSetups,
        projectId: 'github:bernardofernandezz/helix',
        focusedHostScope: 'ssh:openclaw-2'
      })
    ).toBe('helix-ssh')
  })

  it('matches duplicate repo ids to the setup execution host', () => {
    const localRepo = makeRepo('helix', { path: '/local/helix' })
    const sshRepo = makeRepo('helix', {
      path: '/remote/helix',
      connectionId: 'builder'
    })
    const projects = [makeProject('github:bernardofernandezz/helix', ['helix'])]
    const projectHostSetups = [
      makeSetup('local-setup', 'github:bernardofernandezz/helix', 'local', 'helix'),
      makeSetup('ssh-setup', 'github:bernardofernandezz/helix', 'ssh:builder', 'helix')
    ]

    const resolution = resolveWorkspaceCreationTarget({
      eligibleRepos: [localRepo, sshRepo],
      projects,
      projectHostSetups,
      projectHostSetupId: 'ssh-setup'
    })

    expect(resolution).toMatchObject({
      status: 'ready',
      target: {
        hostId: 'ssh:builder',
        repo: { path: '/remote/helix', connectionId: 'builder' }
      }
    })
  })

  it('keeps a focused duplicate repo id on its selected host', () => {
    const localRepo = makeRepo('helix', { path: '/local/helix' })
    const sshRepo = makeRepo('helix', { path: '/remote/helix', connectionId: 'builder' })
    const projects = [makeProject('github:bernardofernandezz/helix', ['helix'])]
    const projectHostSetups = [
      makeSetup('local-setup', 'github:bernardofernandezz/helix', 'local', 'helix'),
      makeSetup('ssh-setup', 'github:bernardofernandezz/helix', 'ssh:builder', 'helix')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [localRepo, sshRepo],
        projects,
        projectHostSetups,
        draftRepoId: 'helix',
        focusedHostScope: 'ssh:builder'
      })
    ).toMatchObject({
      status: 'ready',
      target: {
        hostId: 'ssh:builder',
        projectHostSetupId: 'ssh-setup',
        repo: { path: '/remote/helix', connectionId: 'builder' }
      }
    })
  })

  it('resolves duplicate repo ids to a ready setup when no host is focused', () => {
    const localRepo = makeRepo('helix', { path: '/local/helix' })
    const sshRepo = makeRepo('helix', { path: '/remote/helix', connectionId: 'builder' })
    const projects = [makeProject('github:bernardofernandezz/helix', ['helix'])]
    const projectHostSetups = [
      makeSetup('local-setup', 'github:bernardofernandezz/helix', 'local', 'helix'),
      makeSetup('ssh-setup', 'github:bernardofernandezz/helix', 'ssh:builder', 'helix')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [localRepo, sshRepo],
        projects,
        projectHostSetups,
        draftRepoId: 'helix',
        focusedHostScope: 'all',
        actionableHostIds: new Set(['local', 'ssh:builder'])
      })
    ).toMatchObject({
      status: 'ready',
      target: {
        hostId: 'local',
        projectHostSetupId: 'local-setup',
        repoId: 'helix',
        repo: { path: '/local/helix' }
      }
    })
  })

  it('resolves an explicit project and host to the matching setup', () => {
    const repos = [
      makeRepo('helix-local'),
      makeRepo('helix-runtime', { executionHostId: 'runtime:gpu-1' })
    ]
    const projects = [
      makeProject('github:bernardofernandezz/helix', ['helix-local', 'helix-runtime'])
    ]
    const projectHostSetups = [
      makeSetup('helix-local', 'github:bernardofernandezz/helix', 'local', 'helix-local'),
      makeSetup(
        'helix-runtime',
        'github:bernardofernandezz/helix',
        'runtime:gpu-1',
        'helix-runtime'
      )
    ]

    const resolution = resolveWorkspaceCreationTarget({
      eligibleRepos: repos,
      projects,
      projectHostSetups,
      projectId: 'github:bernardofernandezz/helix',
      hostId: 'runtime:gpu-1'
    })

    expect(resolution).toMatchObject({
      status: 'ready',
      target: {
        projectId: 'github:bernardofernandezz/helix',
        hostId: 'runtime:gpu-1',
        projectHostSetupId: 'helix-runtime',
        repoId: 'helix-runtime'
      }
    })
  })

  it('canonicalizes a stale same-host setup id to the setup the picker shows', () => {
    // Legacy drafts can name hidden duplicate setups; creation must use the canonical picker row/path.
    const repos = [makeRepo('helix-main'), makeRepo('helix-worktree')]
    const projects = [
      makeProject('github:bernardofernandezz/helix', ['helix-main', 'helix-worktree'])
    ]
    const projectHostSetups = [
      makeSetup('helix-main', 'github:bernardofernandezz/helix', 'local', 'helix-main'),
      makeSetup('helix-worktree', 'github:bernardofernandezz/helix', 'local', 'helix-worktree')
    ]

    const resolution = resolveWorkspaceCreationTarget({
      eligibleRepos: repos,
      projects,
      projectHostSetups,
      projectHostSetupId: 'helix-worktree'
    })

    expect(resolution).toMatchObject({
      status: 'ready',
      target: { projectHostSetupId: 'helix-main', repoId: 'helix-main', hostId: 'local' }
    })
  })

  it('keeps an explicit setup id that is the only one on its host', () => {
    const repos = [makeRepo('helix-local'), makeRepo('helix-ssh', { connectionId: 'builder' })]
    const projects = [makeProject('github:bernardofernandezz/helix', ['helix-local', 'helix-ssh'])]
    const projectHostSetups = [
      makeSetup('helix-local', 'github:bernardofernandezz/helix', 'local', 'helix-local'),
      makeSetup('helix-ssh', 'github:bernardofernandezz/helix', 'ssh:builder', 'helix-ssh')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: repos,
        projects,
        projectHostSetups,
        projectHostSetupId: 'helix-ssh'
      })
    ).toMatchObject({
      status: 'ready',
      target: { projectHostSetupId: 'helix-ssh', repoId: 'helix-ssh', hostId: 'ssh:builder' }
    })
  })

  it('does not merge same-name repos without shared project identity', () => {
    const repos = [
      makeRepo('personal-helix', { displayName: 'helix' }),
      makeRepo('work-helix', { displayName: 'helix', connectionId: 'work-linux' })
    ]

    expect(
      resolveWorkspaceCreationRepoId({
        eligibleRepos: repos,
        projectId: 'repo:personal-helix',
        focusedHostScope: 'ssh:work-linux'
      })
    ).toBe('personal-helix')
  })

  it('reports unavailable when the project is not set up on the selected host', () => {
    const repo = makeRepo('helix')
    const projects = [makeProject('github:bernardofernandezz/helix', ['helix'])]
    const projectHostSetups = [
      makeSetup('helix', 'github:bernardofernandezz/helix', 'local', 'helix')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [repo],
        projects,
        projectHostSetups,
        projectId: 'github:bernardofernandezz/helix',
        hostId: 'ssh:openclaw-2'
      })
    ).toEqual({
      status: 'unavailable',
      reason: 'project-not-set-up-on-host'
    })
  })

  it('does not fall back to another host when only a host is selected', () => {
    const localRepo = makeRepo('helix-local')
    const remoteRepo = makeRepo('helix-ssh', { connectionId: 'builder' })
    const projects = [makeProject('github:bernardofernandezz/helix', ['helix-local', 'helix-ssh'])]
    const projectHostSetups = [
      makeSetup('helix-local', 'github:bernardofernandezz/helix', 'local', 'helix-local')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [localRepo, remoteRepo],
        projects,
        projectHostSetups,
        draftRepoId: 'helix-local',
        hostId: 'ssh:builder',
        actionableHostIds: new Set(['local', 'ssh:builder'])
      })
    ).toEqual({
      status: 'unavailable',
      reason: 'project-not-set-up-on-host'
    })
  })

  it('reports setup-not-ready when the selected host has pending setup metadata', () => {
    const repo = makeRepo('helix')
    const projects = [makeProject('github:bernardofernandezz/helix', ['helix'])]
    const projectHostSetups = [
      makeSetup('helix', 'github:bernardofernandezz/helix', 'local', 'helix'),
      makeSetup('gpu-pending', 'github:bernardofernandezz/helix', 'runtime:gpu', '', {
        path: '',
        setupState: 'setting-up',
        setupMethod: 'provisioned'
      })
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [repo],
        projects,
        projectHostSetups,
        projectId: 'github:bernardofernandezz/helix',
        hostId: 'runtime:gpu'
      })
    ).toEqual({
      status: 'unavailable',
      reason: 'setup-not-ready'
    })
  })

  it('reports unavailable when an explicit setup is not ready', () => {
    const repo = makeRepo('helix')
    const projects = [makeProject('github:bernardofernandezz/helix', ['helix'])]
    const projectHostSetups = [
      makeSetup('helix', 'github:bernardofernandezz/helix', 'local', 'helix', {
        setupState: 'setting-up'
      })
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [repo],
        projects,
        projectHostSetups,
        projectHostSetupId: 'helix'
      })
    ).toEqual({
      status: 'unavailable',
      reason: 'setup-not-ready'
    })
  })

  it('does not resolve workspace creation through a removed host', () => {
    const remoteRepo = makeRepo('remote-repo', { connectionId: 'removed' })
    const projects = [makeProject('repo:remote', ['remote-repo'])]
    const projectHostSetups = [
      makeSetup('removed-setup', 'repo:remote', 'ssh:removed', 'remote-repo')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [remoteRepo],
        projects,
        projectHostSetups,
        draftRepoId: remoteRepo.id,
        projectHostSetupId: 'removed-setup',
        actionableHostIds: new Set(['local'])
      })
    ).toEqual({ status: 'unavailable', reason: 'setup-not-found' })
  })

  it('does not silently switch an explicit setup id to an actionable sibling host', () => {
    const remoteRepo = makeRepo('remote-repo', { connectionId: 'removed' })
    const localRepo = makeRepo('local-repo')
    const projects = [makeProject('repo:helix', ['remote-repo', 'local-repo'])]
    const projectHostSetups = [
      makeSetup('removed-setup', 'repo:helix', 'ssh:removed', 'remote-repo'),
      makeSetup('local-setup', 'repo:helix', 'local', 'local-repo')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [remoteRepo, localRepo],
        projects,
        projectHostSetups,
        draftRepoId: remoteRepo.id,
        projectHostSetupId: 'removed-setup',
        actionableHostIds: new Set(['local'])
      })
    ).toEqual({ status: 'unavailable', reason: 'setup-not-found' })
  })

  // Project selection treats the current host as preference; a project available only elsewhere must resolve there instead of silently returning empty.
  describe('cross-host project selection', () => {
    const repos = [makeRepo('local-repo'), makeRepo('remote-repo', { connectionId: 'remote-1' })]
    const projects = [
      makeProject('repo:local-repo', ['local-repo']),
      makeProject('repo:remote-repo', ['remote-repo'])
    ]
    const projectHostSetups = [
      makeSetup('local-repo', 'repo:local-repo', 'local', 'local-repo'),
      makeSetup('remote-repo', 'repo:remote-repo', 'ssh:remote-1', 'remote-repo')
    ]

    it('resolves a remote-only project while the current host is local', () => {
      expect(
        resolveWorkspaceCreationRepoId({
          eligibleRepos: repos,
          projects,
          projectHostSetups,
          projectId: 'repo:remote-repo',
          focusedHostScope: 'local'
        })
      ).toBe('remote-repo')
    })

    it('resolves a local-only project while the current host is remote', () => {
      expect(
        resolveWorkspaceCreationRepoId({
          eligibleRepos: repos,
          projects,
          projectHostSetups,
          projectId: 'repo:local-repo',
          focusedHostScope: 'ssh:remote-1'
        })
      ).toBe('local-repo')
    })

    it('still prefers the current host when the project is set up on it', () => {
      const multiHostProjects = [makeProject('repo:multi', ['multi-local', 'multi-remote'])]
      const multiHostSetups = [
        makeSetup('multi-local', 'repo:multi', 'local', 'multi-local'),
        makeSetup('multi-remote', 'repo:multi', 'ssh:remote-1', 'multi-remote')
      ]

      expect(
        resolveWorkspaceCreationRepoId({
          eligibleRepos: [
            makeRepo('multi-local'),
            makeRepo('multi-remote', { connectionId: 'remote-1' })
          ],
          projects: multiHostProjects,
          projectHostSetups: multiHostSetups,
          projectId: 'repo:multi',
          focusedHostScope: 'local'
        })
      ).toBe('multi-local')
    })

    it('still reports unavailable for an explicit project+host with no ready setup', () => {
      // Explicit Run on host selection retains strict project+host matching; only project-dropdown calls use preference.
      expect(
        resolveWorkspaceCreationTarget({
          eligibleRepos: repos,
          projects,
          projectHostSetups,
          projectId: 'repo:remote-repo',
          hostId: 'local'
        })
      ).toEqual({
        status: 'unavailable',
        reason: 'project-not-set-up-on-host'
      })
    })
  })
})
