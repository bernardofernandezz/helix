import type { SkillInstallDestination } from '../../shared/skill-install-contract'
import type { HelixRuntimeService } from '../runtime/helix-runtime'

export async function classifySkillCloudInstallTarget(
  runtime: HelixRuntimeService,
  input: { environmentId?: string; destination: SkillInstallDestination }
): Promise<'local' | 'remote'> {
  return input.environmentId || (await runtime.skillInstallDestinationUsesSsh(input.destination))
    ? 'remote'
    : 'local'
}
