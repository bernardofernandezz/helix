import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import {
  serializeHelixdMigrationValue,
  type HelixdMigrationImportReceipt,
  type HelixdMigrationManifest
} from '../../../shared/helixd-migration/helixd-migration-manifest'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import { isRepoOnCatalogHost } from '../../../shared/execution-host'
import { assertHelixdMigrationStagedCatalogClaims } from './helixd-staged-catalog-claims'
import {
  toHelixdDestinationFolderWorkspace,
  toHelixdDestinationProjectGroup,
  toHelixdDestinationRepository
} from './helixd-destination-catalog-projection'
import {
  syncProjectHostSetupCompatibilityState,
  type RepoLifecycleOperations
} from '../loading-store/repo-lifecycle-operations'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  applyPreparedHelixdMigrationDormantState,
  prepareHelixdMigrationDormantState,
  type PreparedHelixdMigrationDormantState
} from './helixd-dormant-state-records'
import { sameHelixdRepositoryConfiguration, selectNewRows } from './helixd-catalog-row-identity'

export type PreparedHelixdMigrationCatalog = {
  repositories: Repo[]
  projectGroups: ProjectGroup[]
  folderWorkspaces: FolderWorkspace[]
  newRepositories: Repo[]
  newProjectGroups: ProjectGroup[]
  newFolderWorkspaces: FolderWorkspace[]
  dormantState: PreparedHelixdMigrationDormantState
}

export function assertSameHelixdMigrationManifest(
  staged: HelixdMigrationManifest,
  requested: HelixdMigrationManifest
): void {
  if (staged.manifestSha256 !== requested.manifestSha256) {
    throw new Error('helixd_migration_id_reused_with_different_manifest')
  }
}

// No live PTY migrates, so compare the incoming dormant session as is.
export function prepareHelixdMigrationCatalog(
  manifest: HelixdMigrationManifest,
  state: StoreRuntimeState['state']
): PreparedHelixdMigrationCatalog {
  assertHelixdMigrationStagedCatalogClaims(manifest, state.helixdMigrationStagedCatalogs ?? [])
  const repositories = manifest.payload.repositories.map(toHelixdDestinationRepository)
  const projectGroups = manifest.payload.projectGroups.map(toHelixdDestinationProjectGroup)
  const folderWorkspaces = manifest.payload.folderWorkspaces.map(toHelixdDestinationFolderWorkspace)
  const newRepositories = selectNewRows(
    repositories,
    state.repos,
    catalogConflict('repository'),
    sameHelixdRepositoryConfiguration
  )
  const newProjectGroups = selectNewRows(
    projectGroups,
    state.projectGroups,
    catalogConflict('project_group')
  )
  const newFolderWorkspaces = selectNewRows(
    folderWorkspaces,
    state.folderWorkspaces,
    catalogConflict('folder_workspace')
  )
  assertNoRepositoryPathConflicts(repositories, state.repos)
  assertCatalogReferences({
    repositories,
    projectGroups,
    folderWorkspaces,
    existingProjectGroups: state.projectGroups
  })
  const dormantState = prepareHelixdMigrationDormantState(manifest, state)
  return {
    repositories,
    projectGroups,
    folderWorkspaces,
    newRepositories,
    newProjectGroups,
    newFolderWorkspaces,
    dormantState
  }
}

export function applyPreparedHelixdMigrationCatalog(
  prepared: PreparedHelixdMigrationCatalog,
  state: StoreRuntimeState['state'],
  repos: RepoLifecycleOperations
): void {
  state.projectGroups.push(...prepared.newProjectGroups)
  state.repos.push(...prepared.newRepositories)
  state.folderWorkspaces.push(...prepared.newFolderWorkspaces)
  applyPreparedHelixdMigrationDormantState(prepared.dormantState, state)
  if (prepared.newRepositories.length > 0) {
    syncProjectHostSetupCompatibilityState(repos)
  }
}

export function assertHelixdMigrationReceiptMatchesManifest(
  receipt: HelixdMigrationImportReceipt,
  manifest: HelixdMigrationManifest
): void {
  const expected = {
    source: manifest.source,
    repositoryIds: manifest.payload.repositories.map((repo) => repo.id),
    projectGroupIds: manifest.payload.projectGroups.map((group) => group.id),
    folderWorkspaceIds: manifest.payload.folderWorkspaces.map((workspace) => workspace.id)
  }
  const actual = {
    source: receipt.source,
    repositoryIds: receipt.repositoryIds,
    projectGroupIds: receipt.projectGroupIds,
    folderWorkspaceIds: receipt.folderWorkspaceIds
  }
  if (serializeHelixdMigrationValue(actual) !== serializeHelixdMigrationValue(expected)) {
    throw new Error('helixd_migration_receipt_manifest_mismatch')
  }
}

function catalogConflict(label: string): (id: string) => string {
  return (id) => `helixd_migration_${label}_id_conflict:${id}`
}

function assertNoRepositoryPathConflicts(incoming: Repo[], existing: Repo[]): void {
  const incomingIdSet = new Set(incoming.map((repo) => repo.id))
  const incomingByPath = new Map<string, string>()
  for (const repo of incoming) {
    const key = normalizeRuntimePathForComparison(repo.path)
    const priorId = incomingByPath.get(key)
    if (priorId && priorId !== repo.id) {
      throw new Error(`helixd_migration_repository_path_conflict:${repo.path}`)
    }
    incomingByPath.set(key, repo.id)
  }
  // Same-path rows on other hosts represent different checkouts.
  for (const repo of existing.filter(isRepoOnCatalogHost)) {
    if (
      !incomingIdSet.has(repo.id) &&
      incomingByPath.has(normalizeRuntimePathForComparison(repo.path))
    ) {
      throw new Error(`helixd_migration_repository_path_conflict:${repo.path}`)
    }
  }
}

function assertCatalogReferences(args: {
  repositories: Repo[]
  projectGroups: ProjectGroup[]
  folderWorkspaces: FolderWorkspace[]
  existingProjectGroups: ProjectGroup[]
}): void {
  const groupIds = new Set([
    ...args.existingProjectGroups.map((group) => group.id),
    ...args.projectGroups.map((group) => group.id)
  ])
  for (const group of args.projectGroups) {
    if (group.parentGroupId && !groupIds.has(group.parentGroupId)) {
      throw new Error(`helixd_migration_project_group_parent_missing:${group.id}`)
    }
  }
  for (const repo of args.repositories) {
    if (repo.projectGroupId && !groupIds.has(repo.projectGroupId)) {
      throw new Error(`helixd_migration_repository_project_group_missing:${repo.id}`)
    }
  }
  for (const workspace of args.folderWorkspaces) {
    if (!groupIds.has(workspace.projectGroupId)) {
      throw new Error(`helixd_migration_folder_workspace_project_group_missing:${workspace.id}`)
    }
  }
}
