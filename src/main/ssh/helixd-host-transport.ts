import type { SshTarget } from '../../shared/ssh-types'
import type { WslHelixdHostTarget } from '../wsl/wsl-helixd-host-target'
import type { RemoteInstallTransport } from '../managed-server/install/remote-install-transport'
import type { HelixdLaunchDetach } from '../managed-server/install/helixd-remote-launch'

/** Only id/label have the same meaning across host kinds. */
export type HelixdHostTarget = SshTarget | WslHelixdHostTarget

export function isWslHelixdHostTarget(target: HelixdHostTarget): target is WslHelixdHostTarget {
  return 'kind' in target && target.kind === 'wsl'
}

export type HelixdHostTransport = RemoteInstallTransport & {
  getTarget(): HelixdHostTarget
  /** Absent on SSH, which detaches with nohup. */
  readonly helixdLaunchDetach?: HelixdLaunchDetach
  /** Pass client-only host facts at launch; SSH adds none. */
  readonly helixdLaunchEnv?: () => Promise<readonly HelixdLaunchEnvEntry[]>
}

export type HelixdLaunchEnvEntry = readonly [name: string, value: string]
