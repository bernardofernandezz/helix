// Target claims preserve environment identity so interrupted deploys resume the same registration.
import { getAppEnvironment } from '../../../shared/app-environment'
import { randomUUID } from 'node:crypto'
import { assertRuntimeEnvironmentNotReconciling } from '../../../shared/runtime-environment-reconciliation-record'
import { listEnvironments } from '../../../shared/runtime-environment-store'
import { addManagedHelixdEnvironment } from '../../../shared/runtime-environment-managed-helixd-store'
import {
  getHelixdSshDeployment,
  redactRuntimeEnvironment
} from '../../../shared/runtime-environments'
import {
  HELIXD_MANAGED_REMOTE_PORT,
  type HelixdManagedDeferral,
  type HelixdManagedDeployResult
} from '../../../shared/helixd-managed-runtime'
import { getManagedHelixdFenceEnvironmentId } from '../../../shared/managed-helixd-ssh-owner'
import { runTargetLifecycle } from '../../ipc/ssh/ssh-target-lifecycle-queue'
import { materializeHelixdArtifact } from '../../helixd/helixd-artifact-materializer'
import {
  closeHelixdManagedTunnel,
  ensureHelixdManagedTunnel,
  startHelixdManagedTunnel
} from './helixd-managed-tunnel'
import { recoverInterruptedHelixdActivation } from '../activation/helixd-activation-recovery'
import { wakeAlreadyActiveHelixd } from '../../ssh/helixd-already-active-wake'
import { readHelixdActivationRecord } from '../activation/helixd-activation-record-store'
import {
  resolveHelixdRemoteContext,
  type HelixdRemoteContext
} from '../install/helixd-remote-context'
import { deployHelixd } from '../../ssh/helixd-remote-deploy'
import {
  adoptRunningHelixdVersion,
  type HelixdRunningAdoption
} from '../../ssh/helixd-running-version-adoption'
import { readLocalFullVersion } from '../install/remote-versioned-install'
import { sshHelixdHostTransport } from '../../ssh/helixd-ssh-host-transport'
import { HELIXD_ACTIVATION_POLICY_REFUSED_CODE } from '../../ssh/helixd-installed-activation'
import { pruneManagedHelixdVersions } from './helixd-managed-version-gc'
import { tunneledHelixdPairingCode } from '../../ssh/helixd-tunneled-pairing'
import { resolveHelixdMigrationFence } from '../../ssh/helixd-migration-source-fence'
import type { SshTarget } from '../../../shared/ssh-types'
import { findCollidingEnvironmentName } from '../../../shared/runtime-environment-name-collision'
import { deployedHelixdTunnelChecks } from './helixd-managed-tunnel-identity'
import {
  isForceableHelixdDeferral,
  managedHelixdDeployPolicy,
  managedHelixdSlot,
  probeManagedHelixdReadiness,
  requireManagedHelixdInfrastructure
} from './helixd-managed-runtime-context'

export async function createManagedHelixdEnvironment(
  userDataPath: string,
  args: {
    name: string
    sshTargetId: string
    force?: boolean
    signal?: AbortSignal
    migration?: boolean
  }
): Promise<HelixdManagedDeployResult> {
  return runTargetLifecycle(args.sshTargetId, async () => {
    const { connectionManager, targetStore, claims } = requireManagedHelixdInfrastructure()
    const environmentId =
      getManagedHelixdFenceEnvironmentId(targetStore.getTarget(args.sshTargetId)) ?? randomUUID()
    // Duplicate/name checks before an add: a crash-zeroed list must read as empty here.
    const environments = listEnvironments(userDataPath, { recoverBlankStore: true })
    const registered = environments.find((entry) => entry.id === environmentId)
    if (registered) {
      assertRuntimeEnvironmentNotReconciling(registered)
      if (getHelixdSshDeployment(registered)?.sshTargetId !== args.sshTargetId) {
        throw new Error('The SSH target is owned by a server that is not deployed on it.')
      }
    }
    const namesake = findCollidingEnvironmentName(
      environments.filter((entry) => entry.id !== environmentId),
      args.name
    )
    if (namesake) {
      throw new Error(`A server named "${namesake.name}" already exists.`)
    }
    const current = targetStore.getTarget(args.sshTargetId)
    if (args.migration) {
      assertMigrationFence(userDataPath, current, environmentId, args.name)
    }
    const claimed = claims.claim(args.sshTargetId, environmentId, {
      ...(args.migration ? {} : { deployName: args.name }),
      ownerRecorded:
        Boolean(args.migration) || Boolean(current?.helixdProvisioning) || Boolean(registered)
    })
    await claims.flush(args.signal)
    const targetGeneration = claimed.generation
    if (targetGeneration === undefined) {
      throw new Error(
        'The SSH registration for this host’s Helix server has no durable generation.'
      )
    }
    if (
      registered &&
      getHelixdSshDeployment(registered)?.sshTargetGeneration !== targetGeneration
    ) {
      throw new Error('The saved Helix server for this host has a stale SSH target generation.')
    }
    let environmentRegistered = false
    try {
      const connection = await connectionManager.connect(claimed)
      let context = await resolveHelixdRemoteContext(
        claimed,
        sshHelixdHostTransport(connection),
        args.signal
      )
      const slot = managedHelixdSlot(context, HELIXD_MANAGED_REMOTE_PORT, args.signal)
      const recovery = await recoverInterruptedHelixdActivation(slot)
      if (recovery.outcome === 'pending' || recovery.outcome === 'refused') {
        throw new Error(recovery.reason)
      }
      if (recovery.outcome === 'recovered') {
        context = { ...context, activationRecord: await readHelixdActivationRecord(slot) }
      }
      if (registered) {
        environmentRegistered = true
        const current = await ensureHelixdManagedTunnel(userDataPath, registered.id)
        const activeVersion = context.activationRecord.active
        if (!activeVersion) {
          throw new Error('This host’s Helix server has no active runtime version.')
        }
        return {
          outcome: 'already-current',
          environment: redactRuntimeEnvironment(current),
          activeVersion
        }
      }
      const localHelixdDir = await materializeHelixdArtifact(context.serverTarget, {
        signal: args.signal
      })
      // Adopt before upload: only the paired incumbent can count terminals; redeploy would defer.
      const localVersion = readLocalFullVersion(localHelixdDir)
      const adopted = args.force
        ? null
        : await adoptRunningHelixdVersion(slot, context.activationRecord, localVersion)
      const { active } = context.activationRecord
      if (!adopted && !args.force && active && active !== localVersion) {
        // Wake may observe a peer's changed record; census admission must use that same record.
        context = { ...context, activationRecord: await readHelixdActivationRecord(slot) }
      }
      const serving: DeployedHelixd | HelixdManagedDeferral =
        adopted ??
        (await deployOwnHelixd(context, { ...slot, conn: connection }, localHelixdDir, args))
      if ('outcome' in serving) {
        return serving
      }
      // Read the bound port: the preferred port may belong to another host process.
      const tunnel = deployedHelixdTunnelChecks(serving.readiness, serving.reprobe)
      const localPort = await startHelixdManagedTunnel(
        environmentId,
        claimed,
        connection,
        tunnel.remotePort,
        { ...tunnel, preferredPort: HELIXD_MANAGED_REMOTE_PORT }
      )
      const environment = addManagedHelixdEnvironment(userDataPath, {
        id: environmentId,
        name: args.name,
        pairingCode: tunneledHelixdPairingCode(tunnel.readiness(), localPort),
        helixdDeployment: {
          sshTargetId: claimed.id,
          sshTargetGeneration: targetGeneration,
          localPort,
          remotePort: HELIXD_MANAGED_REMOTE_PORT
        }
      })
      environmentRegistered = true
      return {
        outcome: serving.created ? 'created' : 'already-current',
        environment: redactRuntimeEnvironment(environment),
        activeVersion: serving.version
      }
    } finally {
      if (!environmentRegistered) {
        await closeHelixdManagedTunnel(environmentId).catch(() => undefined)
      }
    }
  })
}

type DeployedHelixd = HelixdRunningAdoption & { created?: true }

async function deployOwnHelixd(
  context: HelixdRemoteContext<SshTarget>,
  slot: ReturnType<typeof managedHelixdSlot>,
  localHelixdDir: string,
  args: { force?: boolean; signal?: AbortSignal }
): Promise<DeployedHelixd | HelixdManagedDeferral> {
  const appVersion = getAppEnvironment().getVersion()
  const deployResult = await deployHelixd({
    ...slot,
    localHelixdDir,
    target: context.serverTarget,
    ...managedHelixdDeployPolicy(context, appVersion, args.force ? 'force' : 'connect'),
    force: args.force,
    appVersion
  })
  if (deployResult.outcome === 'installed-not-activated') {
    return {
      outcome: 'deferred',
      candidateVersion: deployResult.fullVersion,
      code: deployResult.code,
      reason: deployResult.reason,
      forceable:
        isForceableHelixdDeferral(deployResult.code) ||
        deployResult.code === HELIXD_ACTIVATION_POLICY_REFUSED_CODE
    }
  }
  if (deployResult.outcome === 'already-active') {
    await wakeAlreadyActiveHelixd(slot)
  }
  const reprobe = () =>
    probeManagedHelixdReadiness(context, localHelixdDir, deployResult.fullVersion, args.signal)
  const readiness = await reprobe()
  await pruneManagedHelixdVersions({
    slot,
    serverTarget: context.serverTarget,
    activeVersion: deployResult.fullVersion,
    readiness
  })
  return {
    version: deployResult.fullVersion,
    readiness,
    reprobe,
    ...(deployResult.outcome === 'already-active' ? {} : { created: true as const })
  }
}

function assertMigrationFence(
  userDataPath: string,
  target: SshTarget | undefined,
  environmentId: string,
  name: string
): void {
  const fence = target ? resolveHelixdMigrationFence(userDataPath, target) : null
  if (
    fence?.state !== 'fenced' ||
    fence.cutover.destinationEnvironmentId !== environmentId ||
    fence.cutover.destinationName !== name
  ) {
    throw new Error('helixd_migration_fence_required')
  }
}
