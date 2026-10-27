import { stripCredentialsFromMessage } from './git-remote-error'
import type { HelixVmRecipe } from './helix-yaml-hook-types'

export function getProvisionedRootRecipeRepoUrl(
  checkoutMode: HelixVmRecipe['checkoutMode'],
  remoteUrl: string | undefined
): string | undefined {
  if (checkoutMode !== 'provisioned-root' || !remoteUrl) {
    return undefined
  }
  return stripCredentialsFromMessage(remoteUrl)
}
