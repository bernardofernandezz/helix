import { useMemo } from 'react'
import { useAdvancedMode } from '@/hooks/use-advanced-mode'
import {
  getFeatureWallSetupSteps,
  getFirstIncompleteFeatureWallSetupStepId,
  type FeatureWallSetupStepId
} from '../../../../shared/feature-wall-setup-steps'
import type { FeatureWallSetupProgress } from '../feature-wall/feature-wall-setup-progress'
import { useSetupGuideProgress } from '../setup-guide/use-setup-guide-progress'

export type SettingsSetupGuideProgress = {
  ready: boolean
  doneCount: number
  total: number
  firstIncompleteStepId: FeatureWallSetupStepId | null
}

export function getSettingsSetupGuideProgress(
  progress: {
    ready: boolean
    stepDone: Partial<Record<FeatureWallSetupStepId, boolean>>
  },
  advancedMode: boolean
): SettingsSetupGuideProgress {
  const steps = getFeatureWallSetupSteps(advancedMode)
  const doneCount = steps.filter((step) => progress.stepDone[step.id]).length
  const firstIncompleteStepId =
    doneCount === steps.length
      ? null
      : getFirstIncompleteFeatureWallSetupStepId(progress.stepDone, advancedMode)

  return {
    ready: progress.ready,
    doneCount,
    total: steps.length,
    firstIncompleteStepId
  }
}

export function useSettingsSetupGuideProgress(
  shouldRefreshCoreState: boolean
): SettingsSetupGuideProgress {
  const fullProgress = useSettingsSetupGuideFullProgress(shouldRefreshCoreState, false, false)
  const advancedMode = useAdvancedMode()

  return useMemo(
    () => getSettingsSetupGuideProgress(fullProgress, advancedMode),
    [fullProgress, advancedMode]
  )
}

export function useSettingsSetupGuideFullProgress(
  shouldRefreshCoreState: boolean,
  orchestrationSkillInstalled: boolean,
  browserUseSkillInstalled: boolean
): FeatureWallSetupProgress {
  return useSetupGuideProgress(
    shouldRefreshCoreState,
    orchestrationSkillInstalled,
    browserUseSkillInstalled
  )
}
