/** Release conversion setups stranded before staging by refused SSH forwarding. Stop any activated slot, unregister, then use undeployed-fence release; source rows remain intact for retry. */
import { listEnvironments } from '../../shared/runtime-environment-store'
import { removeManagedHelixdEnvironment } from '../../shared/runtime-environment-managed-helixd-store'
import { findHelixdMigrationSourceCutoverForTarget } from './helixd-migration-cutover-journal'
import { releaseUndeployedMigrationFence } from './helixd-migration-source-fence'
import { closeHelixdManagedTunnel } from '../managed-server/lifecycle/helixd-managed-tunnel'
import type { SshTargetHelixdClaims } from './targets/ssh-target-helixd-claims'
import { withHelixdActivationLock } from '../managed-server/activation/helixd-activation-lock'
import { withDeactivatedVersionCommitted } from '../managed-server/activation/helixd-activation-record'
import {
  readHelixdActivationRecord,
  writeHelixdActivationRecord
} from '../managed-server/activation/helixd-activation-record-store'
import { managedHelixdSlot } from '../managed-server/lifecycle/helixd-managed-runtime-context'
import { resolveHelixdRemoteContext } from '../managed-server/install/helixd-remote-context'
import { helixdStopFreedTheHost } from '../managed-server/install/helixd-remote-process-control'
import { helixdSlotDir, stopHelixdSlot } from './helixd-recovery-slot'
import { sshHelixdHostTransport } from './helixd-ssh-host-transport'
import { getSshConnectionManager, getSshTargetRegistryStore } from './targets/ssh-target-registry'
import { errorMessage } from '../../shared/error-message'

export async function releaseUnreachableHelixdSetup(args: {
  userDataPath: string
  claims: SshTargetHelixdClaims
  targetId: string
  signal?: AbortSignal
}): Promise<void> {
  const cutover = findHelixdMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  // Staged/committed destinations require their own evidence before release.
  if (cutover?.phase !== 'source-fenced') {
    return
  }
  const environmentId = cutover.destinationEnvironmentId
  await closeHelixdManagedTunnel(environmentId).catch(() => undefined)
  await stopStrandedHelixd(args.targetId, args.signal).catch((error: unknown) => {
    console.warn(`[helixd] Could not stop the unreachable setup's server: ${errorMessage(error)}`)
  })
  const isRegistered = (id: string): boolean =>
    listEnvironments(args.userDataPath).some((entry) => entry.id === id)
  // Unregister first so an interrupted release leaves a recoverable undeployed fence.
  if (isRegistered(environmentId)) {
    removeManagedHelixdEnvironment(args.userDataPath, environmentId)
  }
  await releaseUndeployedMigrationFence({
    userDataPath: args.userDataPath,
    claims: args.claims,
    targetId: args.targetId,
    isDestinationRegistered: isRegistered,
    signal: args.signal
  })
}

/** Clear active only after proven slot exit; daemon terminals may outlive it. */
async function stopStrandedHelixd(targetId: string, signal?: AbortSignal): Promise<void> {
  const target = getSshTargetRegistryStore()?.getTarget(targetId)
  const connectionManager = getSshConnectionManager()
  if (!target || !connectionManager) {
    return
  }
  const context = await resolveHelixdRemoteContext(
    target,
    sshHelixdHostTransport(await connectionManager.connect(target)),
    signal
  )
  if (!context.activationRecord.active) {
    return
  }
  // Port is irrelevant because this recovery never launches a slot.
  const slot = managedHelixdSlot(context, 0, signal)
  await withHelixdActivationLock(
    slot,
    async () => {
      const record = await readHelixdActivationRecord(slot)
      if (!record.active) {
        return
      }
      const stopped = await stopHelixdSlot(slot, helixdSlotDir(slot, record.active), false)
      if (helixdStopFreedTheHost(stopped)) {
        await writeHelixdActivationRecord(slot, withDeactivatedVersionCommitted(record))
      }
    },
    () => undefined
  )
}
