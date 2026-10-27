import type { HelixdMigrationCatalogPayload } from '../../../shared/helixd-migration/helixd-migration-manifest'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { SshTarget } from '../../../shared/ssh-types'
import type { Store } from '../../persistence'
import {
  helixdSourceFolderWorkspaceIds,
  repoBelongsToHelixdSource
} from './helixd-source-ownership'

type HelixdSourceCatalogStore = Pick<Store, 'getFolderWorkspaces' | 'getProjectGroups' | 'getRepos'>

export function collectHelixdMigrationSourceCatalog(
  store: HelixdSourceCatalogStore,
  target: Pick<SshTarget, 'id'>
): HelixdMigrationCatalogPayload {
  const allRepos = store.getRepos()
  const allGroups = store.getProjectGroups()
  const allFolders = store.getFolderWorkspaces()
  const repositories = allRepos
    .filter((repo) => repoBelongsToHelixdSource(repo, target.id))
    .map((repo) => structuredClone(repo))
  const ownedFolderIds = helixdSourceFolderWorkspaceIds(
    { repos: allRepos, projectGroups: allGroups, folderWorkspaces: allFolders },
    target.id
  )
  const folderWorkspaces = allFolders
    .filter((workspace) => ownedFolderIds.has(workspace.id))
    .map((workspace) => structuredClone(workspace))
  const projectGroups = collectProjectGroups(
    allGroups,
    new Set([
      ...repositories.flatMap((repo) => (repo.projectGroupId ? [repo.projectGroupId] : [])),
      ...folderWorkspaces.map((workspace) => workspace.projectGroupId),
      ...allGroups.filter((group) => group.connectionId === target.id).map((group) => group.id)
    ])
  )
  return { repositories, projectGroups, folderWorkspaces }
}

export function collectProjectGroups(
  groups: ProjectGroup[],
  initialIds: ReadonlySet<string>
): ProjectGroup[] {
  const byId = new Map(groups.map((group) => [group.id, group]))
  const includedIds = new Set(initialIds)
  const pending = [...initialIds]
  while (pending.length > 0) {
    const nextId = pending.pop()
    if (!nextId) {
      continue
    }
    const group = byId.get(nextId)
    if (!group?.parentGroupId || includedIds.has(group.parentGroupId)) {
      continue
    }
    includedIds.add(group.parentGroupId)
    pending.push(group.parentGroupId)
  }
  return groups.filter((group) => includedIds.has(group.id)).map((group) => structuredClone(group))
}
