import type { GlobalSettings } from './global-settings-types'

/** Developer tooling stays out of the research-first default until the user opts in. */
export function isAdvancedMode(
  settings: Pick<GlobalSettings, 'advancedMode'> | null | undefined
): boolean {
  return settings?.advancedMode === true
}
