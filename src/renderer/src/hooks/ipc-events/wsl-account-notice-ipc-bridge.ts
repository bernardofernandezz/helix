import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { WslHelixdAccountNotAppliedEvent } from '../../../../shared/wsl-helixd-account-notice'

export function showWslAccountNotAppliedNotice({ distro }: WslHelixdAccountNotAppliedEvent): void {
  toast.info(
    translate(
      'accounts.wslAccountNotApplied.title',
      'Account selection not applied in {{distro}}',
      { distro }
    ),
    {
      // Why a stable id: main sends once per distro, but a second window must not stack another.
      id: `wsl-account-not-applied:${distro.toLowerCase()}`,
      description: translate(
        'accounts.wslAccountNotApplied.description',
        "Agents there use the distro's default Claude and Codex accounts until Helix in WSL is updated."
      )
    }
  )
}

/** Main owns when this fires (once per distro); the renderer only presents it. */
export function registerWslAccountNoticeIpcBridge(unsubs: (() => void)[]): void {
  const subscribe = window.api.runtimeEnvironments?.onWslAccountNotApplied
  if (subscribe) {
    unsubs.push(subscribe(showWslAccountNotAppliedNotice))
  }
}
