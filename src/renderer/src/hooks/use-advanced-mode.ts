import { useMemo } from 'react'
import { isAdvancedMode } from '../../../shared/advanced-mode'
import type { WorktreeCardProperty } from '../../../shared/ui-chrome-types'
import { visibleWorktreeCardProperties } from '../../../shared/worktree/card-properties'
import { useAppStore } from '@/store'

export function useAdvancedMode(): boolean {
  return useAppStore((state) => isAdvancedMode(state.settings))
}

/** Card rows to render; memoized so store reads keep a stable array. */
export function useVisibleWorktreeCardProperties(): WorktreeCardProperty[] {
  const properties = useAppStore((state) => state.worktreeCardProperties)
  const advancedMode = useAdvancedMode()
  return useMemo(
    () => visibleWorktreeCardProperties(properties, advancedMode),
    [properties, advancedMode]
  )
}
