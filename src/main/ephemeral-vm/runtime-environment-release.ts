import type { EphemeralVmRuntimeRecord } from '../../shared/ephemeral-vm-runtimes'
import { removeManagedHelixdEnvironment } from '../../shared/runtime-environment-managed-helixd-store'
import { listEnvironments, removeEnvironment } from '../../shared/runtime-environment-store'
import { getHelixdSshDeployment } from '../../shared/runtime-environments'

/** Remove destroyed VM servers so managed tunnels stop reconnecting. */
export async function releaseEphemeralVmRuntimeEnvironments(
  userDataPath: string,
  runtime: Pick<EphemeralVmRuntimeRecord, 'runtimeEnvironmentId' | 'sshTargetId'>,
  // Same retirement as a Settings removal, so the host's session partition and transport go too.
  retireRemovedEnvironment: (environmentId: string) => void
): Promise<void> {
  // Relay-era conversions may have recorded only the SSH target, not the server ID.
  const environments = listEnvironments(userDataPath).filter(
    (entry) =>
      entry.id === runtime.runtimeEnvironmentId ||
      (runtime.sshTargetId !== undefined &&
        getHelixdSshDeployment(entry)?.sshTargetId === runtime.sshTargetId)
  )
  for (const environment of environments) {
    if (!environment.helixdDeployment) {
      removeEnvironment(userDataPath, environment.id)
      retireRemovedEnvironment(environment.id)
      continue
    }
    const { closeHelixdManagedTunnel } =
      await import('../managed-server/lifecycle/helixd-managed-tunnel')
    await closeHelixdManagedTunnel(environment.id).catch(() => undefined)
    removeManagedHelixdEnvironment(userDataPath, environment.id)
    retireRemovedEnvironment(environment.id)
  }
}
