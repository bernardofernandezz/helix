import type { DiscoveredSkill } from '../../../shared/skills'
import {
  GLOBAL_AGENT_SKILL_SOURCE_KINDS,
  hasInstalledAgentSkill
} from '@/hooks/useInstalledAgentSkills'
import { LINEAR_TICKETS_SKILL_NAME, HELIX_LINEAR_SKILL_NAME } from '@/lib/agent-feature-skill-names'

export type LinearAgentSkillUpdateTarget = {
  skillName: typeof HELIX_LINEAR_SKILL_NAME | typeof LINEAR_TICKETS_SKILL_NAME
}

// Use the installed legacy name only for legacy-only installs; canonical/fresh/both use the canonical skill.
export function getLinearAgentSkillUpdateTarget(
  skills: readonly DiscoveredSkill[],
  installed: boolean
): LinearAgentSkillUpdateTarget {
  const canonicalSkillInstalled = hasInstalledAgentSkill(skills, HELIX_LINEAR_SKILL_NAME, {
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })
  const legacySkillInstalled = hasInstalledAgentSkill(skills, LINEAR_TICKETS_SKILL_NAME, {
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })
  const skillName =
    !installed || canonicalSkillInstalled || !legacySkillInstalled
      ? HELIX_LINEAR_SKILL_NAME
      : LINEAR_TICKETS_SKILL_NAME
  return { skillName }
}
