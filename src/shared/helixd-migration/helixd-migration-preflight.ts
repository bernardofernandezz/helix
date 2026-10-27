import type { FolderWorkspace } from '../folder-workspace-types'
import type { Repo } from '../repo-types'
import type { SavedPortForward, SshRemotePtyLease } from '../ssh-types'

export const HELIXD_MIGRATION_DEPENDENCY_KINDS = [
  'saved-port-forward',
  'terminal-lease',
  'terminal-recovery',
  'workspace-session',
  'worktree-metadata',
  'worktree-lineage',
  'workspace-lineage',
  'sparse-preset',
  'retired-worktree-name',
  'automation',
  'automation-run',
  'mobile-tab-selection',
  'ui-routing'
] as const

export type HelixdMigrationDependencyKind = (typeof HELIXD_MIGRATION_DEPENDENCY_KINDS)[number]

export type HelixdMigrationDependency = {
  kind: HelixdMigrationDependencyKind
  count: number
  /** A bounded sample of what holds the reference, so the user can find and clear it. */
  names?: string[]
}

export type HelixdMigrationRepository = Pick<Repo, 'id' | 'path' | 'displayName' | 'kind'>
export type HelixdMigrationFolderWorkspace = Pick<FolderWorkspace, 'id' | 'name' | 'folderPath'>
export type HelixdMigrationTerminalLease = Pick<
  SshRemotePtyLease,
  'ptyId' | 'worktreeId' | 'tabId' | 'leafId' | 'state' | 'updatedAt'
>

export type HelixdMigrationBlocker =
  | {
      code: 'helixd_migration_target_not_found'
      category: 'registration'
    }
  | {
      code: 'helixd_migration_target_owned'
      category: 'exclusive-ownership'
      holder:
        | { kind: 'runtime'; runtimeId: string }
        | { kind: 'managed-server'; environmentId: string }
    }
  | {
      /** Owned by the asking environment, but no durable record of why. */
      code: 'helixd_migration_owner_unrecorded'
      category: 'exclusive-ownership'
    }
  | {
      code: 'helixd_migration_direct_ssh_repositories'
      category: 'drainable-static-state'
      repositories: HelixdMigrationRepository[]
    }
  | {
      code: 'helixd_migration_direct_ssh_folder_workspaces'
      category: 'drainable-static-state'
      folderWorkspaces: HelixdMigrationFolderWorkspace[]
    }
  | {
      code: 'helixd_migration_direct_ssh_terminal_leases'
      category: 'live-or-unverifiable'
      terminalLeases: HelixdMigrationTerminalLease[]
    }
  | {
      code: 'helixd_migration_saved_port_forwards'
      category: 'client-owned-state'
      portForwards: SavedPortForward[]
    }
  | {
      code: 'helixd_migration_dependent_state'
      category: 'client-owned-state'
      dependencies: HelixdMigrationDependency[]
    }
  | {
      code: 'helixd_migration_dependency_unverifiable'
      category: 'live-or-unverifiable'
      sources: HelixdMigrationDependencyKind[]
    }

export type HelixdMigrationPreflight = {
  targetId: string
  targetLabel: string | null
  claimable: boolean
  blockers: HelixdMigrationBlocker[]
}
