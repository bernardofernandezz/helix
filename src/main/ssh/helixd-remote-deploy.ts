/** Activate under a durable host fence/journal only after candidate readiness. Recover the incumbent only with safe profile state; retain changed state/snapshot for explicit recovery. */
import { logHelixdActivationOutcome } from '../managed-server/activation/helixd-activation-outcome-log'
import { join } from 'node:path'
import type { HelixdHostTransport } from './helixd-host-transport'
import type { HelixdUpdateForce } from './helixd-update-plan'
import { HELIXD_INSTALL_MODEL } from '../managed-server/install/remote-install-model'
import {
  computeRemoteInstallDir,
  readLocalFullVersion
} from '../managed-server/install/remote-versioned-install'
import { readHelixdActivationRecord } from '../managed-server/activation/helixd-activation-record-store'
import type { HelixdActivationRecord } from '../managed-server/activation/helixd-activation-record'
import type { HelixdActivationVerdict } from '../managed-server/activation/helixd-activation-gate'
import type { HelixdTerminalCensus } from '../../shared/helixd-terminal-census'
import type { RemoteHostPlatform } from './ssh-remote-platform'
import { installHelixdBundle } from '../managed-server/install/helixd-remote-install'
import { getAppEnvironment } from '../../shared/app-environment'
import type { NodeRuntimeTarget } from '../../shared/node-runtime-pin'
import { HELIXD_STARTUP_READINESS_TIMEOUT_MS } from '../../shared/helixd-profile-preflight'
import { materializeHelixdArtifact } from '../helixd/helixd-artifact-materializer'
import { readHelixdBundleTarget } from './helixd-deployment-target'
import { resolveHelixdRuntimeTarget } from '../managed-server/lifecycle/helixd-runtime-target'
import {
  materializeNodeRuntimeArchive,
  nodeRuntimeArchiveCachePath
} from '../node-runtime/pinned-runtime-materializer'
import {
  helixdActivationFenceExists,
  resolveHelixdActivationReadinessTimeout,
  withHelixdActivationLock
} from '../managed-server/activation/helixd-activation-lock'
import { activateInstalledHelixd } from './helixd-installed-activation'
import { helixdActivationFenceRefusal } from '../managed-server/activation/helixd-activation-fence-hold'

export type HelixdDeployOptions = {
  conn: HelixdHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  /** An already assembled bundle; otherwise materialize the packaged template for this host. */
  localHelixdDir?: string
  /** The bundle's runtime target; read from `localHelixdDir` or probed when absent. */
  target?: NodeRuntimeTarget
  /** Where the pinned runtime archive is cached; defaults beside the helixd artifact cache. */
  runtimeCacheRoot?: string
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  /** Caller supplies a protocol-aware census; unanswered host evidence must never become zero live terminals. */
  census: HelixdTerminalCensus
  /** Bind census to its incumbent record; a changed locked record makes earlier counts unverifiable. */
  censusRecord?: HelixdActivationRecord
  /** Recount under fence just before stopping the same incumbent; uploads may outdate initial counts and failures stay unverifiable. */
  recountCensus: () => Promise<HelixdTerminalCensus>
  /** Best-effort reopen when incumbent keeps serving; admission also expires server-side. */
  releaseIncumbentAdmission: () => Promise<void>
  force?: HelixdUpdateForce
  /** The Helix app version activating, recorded so an older client never downgrades the host. */
  appVersion?: string
  /** Reapply version policy under lock because peer activation/stop may land during upload. */
  admitRecord?: (record: HelixdActivationRecord, candidateVersion: string) => string | null
  readinessTimeoutMs?: number
  /** WSL only; SSH hosts always re-hash the runtime (see `installHelixdBundle`). */
  recordedNodeRuntimeProbe?: boolean
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

export type HelixdDeployResult =
  | { outcome: 'installed-and-activated'; fullVersion: string; verdict: HelixdActivationVerdict }
  | { outcome: 'already-active'; fullVersion: string }
  | { outcome: 'installed-not-activated'; fullVersion: string; code: string; reason: string }

export async function deployHelixd(
  input: HelixdDeployOptions,
  retryClearedFence = true
): Promise<HelixdDeployResult> {
  const target =
    input.target ??
    (input.localHelixdDir
      ? readHelixdBundleTarget(input.localHelixdDir)
      : await resolveHelixdRuntimeTarget(input))
  const runtimeCacheRoot =
    input.runtimeCacheRoot ?? join(getAppEnvironment().getPath('userData'), 'helixd-artifacts')
  const options = {
    ...input,
    target,
    readinessTimeoutMs: resolveHelixdActivationReadinessTimeout(
      input.readinessTimeoutMs,
      HELIXD_STARTUP_READINESS_TIMEOUT_MS
    ),
    nodeRuntimeArchive: () =>
      materializeNodeRuntimeArchive(target, runtimeCacheRoot, { signal: input.signal }),
    nodeRuntimeOfflineArchivePath: nodeRuntimeArchiveCachePath(target, runtimeCacheRoot),
    localHelixdDir:
      input.localHelixdDir ?? (await materializeHelixdArtifact(target, { signal: input.signal }))
  }
  const fullVersion = readLocalFullVersion(options.localHelixdDir)
  const remoteDir = computeRemoteInstallDir(HELIXD_INSTALL_MODEL, options.remoteHome, fullVersion)
  const held = async (): Promise<HelixdDeployResult> => {
    const { cleared, ...refusal } = await helixdActivationFenceRefusal(options, 'update')
    // Retry one cleared abandoned fence; repeated abandonment must surface to the caller.
    if (cleared && retryClearedFence) {
      return deployHelixd({ ...input, target, localHelixdDir: options.localHelixdDir }, false)
    }
    return { outcome: 'installed-not-activated', fullVersion, ...refusal }
  }
  // Refuse before upload, then re-read both admission inputs under fence.
  const preUploadRecord = await readHelixdActivationRecord(options)
  const censusRecord = options.censusRecord ?? preUploadRecord
  // An unanswered probe only skips this shortcut; lock acquisition still arbitrates.
  if (await helixdActivationFenceExists(options).catch(() => false)) {
    return held()
  }

  await installHelixdBundle(options, fullVersion, remoteDir)

  return logHelixdActivationOutcome(
    `update to ${fullVersion}`,
    () =>
      withHelixdActivationLock(
        options,
        (lock) =>
          activateInstalledHelixd({ ...options, censusRecord }, fullVersion, remoteDir, lock),
        held
      ),
    ['installed-and-activated', 'already-active']
  )
}
