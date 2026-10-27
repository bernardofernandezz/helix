export type SetupRunPolicy = 'ask' | 'run-by-default' | 'skip-by-default'
export type SetupAgentStartupPolicy = 'start-immediately' | 'wait-for-setup'
export type HookCommandSourcePolicy = 'shared-only' | 'local-only' | 'run-both'

export type HelixHooks = {
  scripts: {
    setup?: string // Runs after worktree is created
    archive?: string // Runs before worktree is archived
  }
  setupAgentStartupPolicy?: SetupAgentStartupPolicy
  issueCommand?: string // Shared default command for linked GitHub issues
  defaultTabs?: HelixDefaultTabTemplate[] // Terminal tabs to create once for a new worktree
  environmentRecipes?: HelixVmRecipe[] // Project-scoped per-workspace environment recipes
  environmentRecipeDiagnostics?: HelixVmRecipeDiagnostic[] // Non-fatal validation issues from environmentRecipes
  worktree?: HelixWorktreeDefaults // Project-scoped defaults applied when a worktree is created
}

export type HelixWorktreeDefaults = {
  // Share large rebuildable directories such as node_modules across worktrees instead of copying installs.
  sharedDirectories?: string[]
}

export type HelixDefaultTabTemplate = {
  title?: string
  color?: string
  command?: string
}

export type EphemeralVmCheckoutMode = 'helix-worktree' | 'provisioned-root'

export type HelixVmRecipe = {
  id: string
  name: string
  create: string
  checkoutMode?: EphemeralVmCheckoutMode
  description?: string
  suspend?: string
  resume?: string
  destroy?: string
  destroyDisabled?: boolean
}

export type HelixVmRecipeDiagnostic = {
  index: number
  field?: string
  message: string
}

export type RepoHookSettings = {
  // Retain the old hook-UI mode so persisted state reads without migration.
  mode: 'auto' | 'override'
  setupRunPolicy?: SetupRunPolicy
  setupAgentStartupPolicy?: SetupAgentStartupPolicy
  commandSourcePolicy?: HookCommandSourcePolicy
  scripts: {
    setup: string
    archive: string
  }
}

export type PersistedTrustedHelixHookEntry = {
  contentHash: string
  approvedAt: number
}

export type PersistedTrustedHelixHookRepo = {
  all?: {
    approvedAt: number
  }
  setup?: PersistedTrustedHelixHookEntry
  archive?: PersistedTrustedHelixHookEntry
  issueCommand?: PersistedTrustedHelixHookEntry
  vmRecipe?: PersistedTrustedHelixHookEntry
}

export type PersistedTrustedHelixHooks = Record<string, PersistedTrustedHelixHookRepo>
