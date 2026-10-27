// Host answers both the desktop sidebar's and the phone's Project grouping tests run on.
import type { MobileProjectSectionCatalog } from './mobile-project-sections-contract'
import type { ExecutionHostId } from './execution-host'
import {
  projectHostSetupProjectionFromRepos,
  type ProjectHostSetupProjection
} from './project-host-setup-projection'
import type { Repo } from './repo-types'
import type { RuntimeClientTarget } from './runtime-client-target'

const helixRemote = {
  canonicalKey: 'github.com/bernardofernandezz/helix',
  remoteName: 'origin',
  remoteUrl: 'git@github.com:bernardofernandezz/helix.git'
}

function hostRepo(id: string, path: string, displayName = 'helix'): Repo {
  return {
    id,
    path,
    displayName,
    badgeColor: '#737373',
    addedAt: 1,
    ...(displayName === 'helix' ? { gitRemoteIdentity: helixRemote } : {})
  }
}

export type ParityHostAnswer = {
  target: RuntimeClientTarget
  hostId: ExecutionHostId
  /** In the host's own repo.list order. */
  repos: Repo[]
  /** The host's project.list/projectHostSetup.list rows; null for a host that predates them. */
  lists: ProjectHostSetupProjection | null
}

const localRepos = [
  hostRepo('local-bernardofernandezz', '/Users/marina/bernardofernandezz/helix'),
  hostRepo('local-assets', '/Users/marina/design-assets', 'design-assets'),
  hostRepo('local-workspace', '/Users/marina/helix/workspaces/helix/helix')
]
const windowsRepo = hostRepo('win-helix', 'C:/Users/maria/helix/helix')

// Several local checkouts plus copies of the same project on two servers.
export const PROJECT_SECTION_PARITY_HOSTS: readonly ParityHostAnswer[] = [
  {
    target: { kind: 'local' },
    hostId: 'local',
    repos: localRepos,
    lists: projectHostSetupProjectionFromRepos(localRepos)
  },
  {
    target: { kind: 'environment', environmentId: 'windows2' },
    hostId: 'runtime:windows2',
    repos: [windowsRepo],
    // A server's own catalog rows: its project name and an imported setup on its local host.
    lists: {
      projects: [
        {
          id: 'github:bernardofernandezz/helix',
          displayName: 'Helix',
          badgeColor: '#737373',
          providerIdentity: { provider: 'github', owner: 'bernardofernandezz', repo: 'helix' },
          sourceRepoIds: [windowsRepo.id],
          createdAt: 5,
          updatedAt: 5
        }
      ],
      setups: [
        {
          id: 'win-setup',
          projectId: 'github:bernardofernandezz/helix',
          hostId: 'local',
          repoId: windowsRepo.id,
          path: windowsRepo.path,
          displayName: 'helix',
          setupState: 'ready',
          setupMethod: 'imported-existing-folder',
          createdAt: 5,
          updatedAt: 5
        }
      ]
    }
  },
  {
    target: { kind: 'environment', environmentId: 'm4air' },
    hostId: 'runtime:m4air',
    repos: [
      hostRepo('m4-helix', '/Users/m4air/helix/helix'),
      hostRepo('m4-helix-two', '/Users/m4air/helix-two/helix')
    ],
    lists: null
  }
]

/** Workspace rows; activity order differs from catalog order, so Recent and Manual disagree. */
export const PROJECT_SECTION_PARITY_ROWS: readonly {
  id: string
  repoId: string
  lastActivityAt: number
}[] = [
  { id: 'wt-m4-two', repoId: 'm4-helix-two', lastActivityAt: 90 },
  { id: 'wt-win', repoId: 'win-helix', lastActivityAt: 70 },
  { id: 'wt-workspace', repoId: 'local-workspace', lastActivityAt: 50 },
  { id: 'wt-bernardofernandezz', repoId: 'local-bernardofernandezz', lastActivityAt: 30 },
  { id: 'wt-m4', repoId: 'm4-helix', lastActivityAt: 10 }
]

// Same-host checkouts still need path prefixes; other machines do not.
const ACME = {
  key: 'project:github:bernardofernandezz/helix::setup:local-bernardofernandezz',
  label: 'bernardofernandezz/helix'
}
const WORKSPACE = {
  key: 'project:github:bernardofernandezz/helix::setup:local-workspace',
  label: 'helix/helix'
}
// Why 'helix', not the server's 'Helix': the later host's derived project name wins the merge.
const WINDOWS = { key: 'project:github:bernardofernandezz/helix', label: 'helix' }
const M4 = { key: 'project:github:bernardofernandezz/helix::setup:m4-helix', label: 'helix/helix' }
const M4_TWO = {
  key: 'project:github:bernardofernandezz/helix::setup:m4-helix-two',
  label: 'helix-two/helix'
}
const ASSETS = { key: 'project:repo:local-assets', label: 'design-assets' }

export const PROJECT_SECTION_PARITY_HEADERS = {
  recent: [M4_TWO, WINDOWS, WORKSPACE, ACME, M4, ASSETS],
  manual: [ACME, ASSETS, WORKSPACE, WINDOWS, M4, M4_TWO]
} as const

/** What main serves the phone for these answers (the renderer's published catalog). */
export const PROJECT_SECTION_PARITY_SERVED: MobileProjectSectionCatalog = {
  repos: [
    {
      id: 'local-bernardofernandezz',
      displayName: 'helix',
      path: '/Users/marina/bernardofernandezz/helix',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'local'
    },
    {
      id: 'local-assets',
      displayName: 'design-assets',
      path: '/Users/marina/design-assets',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'local'
    },
    {
      id: 'local-workspace',
      displayName: 'helix',
      path: '/Users/marina/helix/workspaces/helix/helix',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'local'
    },
    {
      id: 'win-helix',
      displayName: 'helix',
      path: 'C:/Users/maria/helix/helix',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'runtime:windows2'
    },
    {
      id: 'm4-helix',
      displayName: 'helix',
      path: '/Users/m4air/helix/helix',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'runtime:m4air'
    },
    {
      id: 'm4-helix-two',
      displayName: 'helix',
      path: '/Users/m4air/helix-two/helix',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'runtime:m4air'
    }
  ],
  projects: [
    { id: 'repo:local-assets', displayName: 'design-assets' },
    { id: 'github:bernardofernandezz/helix', displayName: 'helix' }
  ],
  setups: [
    {
      id: 'local-bernardofernandezz',
      projectId: 'github:bernardofernandezz/helix',
      hostId: 'local',
      repoId: 'local-bernardofernandezz',
      path: '/Users/marina/bernardofernandezz/helix',
      displayName: 'helix',
      setupMethod: 'legacy-repo'
    },
    {
      id: 'local-assets',
      projectId: 'repo:local-assets',
      hostId: 'local',
      repoId: 'local-assets',
      path: '/Users/marina/design-assets',
      displayName: 'design-assets',
      setupMethod: 'legacy-repo'
    },
    {
      id: 'local-workspace',
      projectId: 'github:bernardofernandezz/helix',
      hostId: 'local',
      repoId: 'local-workspace',
      path: '/Users/marina/helix/workspaces/helix/helix',
      displayName: 'helix',
      setupMethod: 'legacy-repo'
    },
    {
      id: 'win-setup',
      projectId: 'github:bernardofernandezz/helix',
      hostId: 'runtime:windows2',
      repoId: 'win-helix',
      path: 'C:/Users/maria/helix/helix',
      displayName: 'helix',
      setupMethod: 'imported-existing-folder',
      connectionId: null,
      executionHostId: 'runtime:windows2'
    },
    {
      id: 'm4-helix',
      projectId: 'github:bernardofernandezz/helix',
      hostId: 'runtime:m4air',
      repoId: 'm4-helix',
      path: '/Users/m4air/helix/helix',
      displayName: 'helix',
      setupMethod: 'legacy-repo',
      executionHostId: 'runtime:m4air'
    },
    {
      id: 'm4-helix-two',
      projectId: 'github:bernardofernandezz/helix',
      hostId: 'runtime:m4air',
      repoId: 'm4-helix-two',
      path: '/Users/m4air/helix-two/helix',
      displayName: 'helix',
      setupMethod: 'legacy-repo',
      executionHostId: 'runtime:m4air'
    }
  ],
  projectOrderBy: 'manual'
}
