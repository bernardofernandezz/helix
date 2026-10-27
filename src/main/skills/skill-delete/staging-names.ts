/** Hide transaction siblings from discovery to avoid duplicate rows and repeat deletes. Match the shared .*.helix-* shape so native checks and WSL find-prune agree. */
export const SKILL_DELETE_STAGING_MARKER = '.helix-skill-delete-'

export const BUNDLED_SKILL_STAGE_MARKER = '.helix-stage-'
export const BUNDLED_SKILL_OLD_MARKER = '.helix-old-'

/** The `find -name` glob the WSL guest script prunes on. */
export const SKILL_STAGING_GLOB = '.*.helix-*'

const SKILL_STAGING_NAME = /^\..+\.helix-/u

export function isSkillStagingEntryName(name: string): boolean {
  return SKILL_STAGING_NAME.test(name)
}

export function skillDeleteStagedName(basename: string, id: string): string {
  return `.${basename}${SKILL_DELETE_STAGING_MARKER}${id}`
}

export function isSkillDeleteStagedName(basename: string, staged: string): boolean {
  return staged.startsWith(`.${basename}${SKILL_DELETE_STAGING_MARKER}`)
}
