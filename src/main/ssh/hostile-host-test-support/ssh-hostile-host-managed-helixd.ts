/** Prove each host gets only its required runtime without toolchain use, then either a live server or its expected classified refusal. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { expect } from 'vitest'
import { NODE_RUNTIME_ASSETS, pinnedNodeRuntimeAsset } from '../../../shared/node-runtime-pin'
import { HELIXD_MANAGED_REMOTE_PORT } from '../../../shared/helixd-managed-runtime'
import { HELIXD_RUNTIMES_DIRNAME } from '../../../shared/helixd-artifacts'
import type { SshTarget } from '../../../shared/ssh-types'
import { readHelixdActivationRecord } from '../../managed-server/activation/helixd-activation-record-store'
import { classifyHelixdHostUnavailable } from '../../helixd/helixd-host-unavailable'
import { managedHelixdSlot } from '../../managed-server/lifecycle/helixd-managed-runtime-context'
import { helixdSlotDir, type HelixdSlotOptions } from '../helixd-recovery-slot'
import { resolveHelixdRemoteContext } from '../../managed-server/install/helixd-remote-context'
import { deployHelixd } from '../helixd-remote-deploy'
import { getMainHttpClient, setMainHttpClient } from '../../network/http-client'
import {
  helixdLivenessProbeCommand,
  parseHelixdLiveness
} from '../../managed-server/install/helixd-remote-launch'
import { execHelixdRemote } from '../../managed-server/install/helixd-remote-runtime-control'
import {
  HELIXD_PID_FILENAME,
  HELIXD_READINESS_FILENAME
} from '../../managed-server/install/helixd-remote-host-support'
import { decommissionRemoteHelixd } from '../../managed-server/install/helixd-remote-decommission'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import {
  forbiddenToolActions,
  type HostileHostCellCore,
  type ManagedHelixdExpectation
} from './ssh-hostile-host-cells'
import { connectHostileHost } from './ssh-hostile-host-test-harness'
import { hostExec, hostExecStatus, type HostileHostTarget } from './ssh-hostile-host-test-fixture'

const EMPTY_CENSUS = { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: null }

export async function proveManagedHelixdCell(
  cell: HostileHostCellCore,
  target: HostileHostTarget,
  sshTarget: SshTarget
): Promise<void> {
  const expected = cell.managed
  const conn = await connectHostileHost(sshTarget)
  try {
    const context = await resolveHelixdRemoteContext(sshTarget, conn)
    expect(context.serverTarget).toBe(expected.runtime)
    const slot = managedHelixdSlot(context, HELIXD_MANAGED_REMOTE_PORT)
    const desktop = cell.desktopNoEgress ? refuseDesktopDownloads() : null
    const deploy = deployHelixd({
      ...slot,
      target: context.serverTarget,
      census: EMPTY_CENSUS,
      recountCensus: async () => EMPTY_CENSUS,
      releaseIncumbentAdmission: async () => {},
      ...(desktop ? { runtimeCacheRoot: desktop.cacheRoot } : {})
    }).finally(() => desktop?.restore())
    if (expected.outcome === 'unavailable') {
      const failure = await deploy.then(
        (deployed) => new Error(`deploy did not fail: ${JSON.stringify(deployed)}`),
        (error: unknown) => error
      )
      expect(classifyHelixdHostUnavailable(failure), String(failure)).toBe(expected.reason)
    } else {
      const deployed = await deploy
      const slotDir = helixdSlotDir(slot, deployed.fullVersion)
      await assertOnlyRuntimeUploaded(target, slotDir, expected)
      // The message carries the full reason, which toMatchObject's diff omits.
      expect(deployed, JSON.stringify(deployed)).toMatchObject({
        outcome: 'installed-and-activated'
      })
      await assertLiveThenDecommissioned(slot, slotDir, deployed.fullVersion)
    }
    if (desktop) {
      // With an empty cache and every fetch refused there was nothing to upload, so the host fetched it.
      expect(desktop.refusedUrls().length).toBeGreaterThan(0)
    }
    const toolLog = await hostExec(
      target,
      `cat ${quotePosixShell(target.forbiddenToolLog)} 2>/dev/null || true`
    )
    expect(forbiddenToolActions(toolLog)).toEqual([])
  } finally {
    await conn.disconnect().catch(() => {})
  }
}

/** A default runtime beside the expected one is the wrong upload this cell guards against. */
async function assertOnlyRuntimeUploaded(
  target: HostileHostTarget,
  slotDir: string,
  expected: ManagedHelixdExpectation
): Promise<void> {
  const runtimes = posix.join(posix.dirname(slotDir), HELIXD_RUNTIMES_DIRNAME)
  const runtimeDir = (sha: string): string => posix.join(runtimes, `node-${sha}`)
  const { executableSha256 } = pinnedNodeRuntimeAsset(expected.runtime)
  expect(await hostExecStatus(target, `test -x '${runtimeDir(executableSha256)}/bin/node'`)).toBe(0)
  for (const asset of Object.values(NODE_RUNTIME_ASSETS)) {
    if (asset.executableSha256 !== executableSha256) {
      expect(
        await hostExecStatus(target, `test -e '${runtimeDir(asset.executableSha256)}'`)
      ).not.toBe(0)
    }
  }
}

async function assertLiveThenDecommissioned(
  slot: HelixdSlotOptions,
  slotDir: string,
  version: string
): Promise<void> {
  const liveness = async (): Promise<string> =>
    parseHelixdLiveness(
      await execHelixdRemote(slot, helixdLivenessProbeCommand(slot.host, slotDir))
    )
  expect(await liveness()).toBe('LIVE')
  await assertHelixdRunsAtLoginUmask(slot, slotDir)
  const decommission = await decommissionRemoteHelixd({
    ...slot,
    record: await readHelixdActivationRecord(slot),
    census: EMPTY_CENSUS
  })
  expect(decommission, JSON.stringify(decommission)).toMatchObject({
    outcome: 'decommissioned',
    version
  })
  expect(await liveness()).toBe('DEAD')
}

/** inherit SSH login umask for user files while pairing-token readiness stays owner-only. Linux /proc exposes the daemon umask; macOS does not. */
async function assertHelixdRunsAtLoginUmask(
  slot: HelixdSlotOptions,
  slotDir: string
): Promise<void> {
  if (slot.host.os !== 'linux') {
    return
  }
  const pidFile = quotePosixShell(posix.join(slotDir, HELIXD_PID_FILENAME))
  const readiness = quotePosixShell(posix.join(slotDir, HELIXD_READINESS_FILENAME))
  const [login, daemon, readinessMode] = (
    await execHelixdRemote(
      slot,
      `umask; sed -n 's/^Umask:[[:space:]]*//p' "/proc/$(cat ${pidFile})/status"; stat -c %a ${readiness}`
    )
  )
    .trim()
    .split('\n')
    .map((line) => line.trim())
  expect(Number.parseInt(daemon ?? '', 8), `login ${login}, helixd ${daemon}`).toBe(
    Number.parseInt(login ?? '', 8)
  )
  expect(readinessMode).toBe('600')
}

function refuseDesktopDownloads(): {
  cacheRoot: string
  refusedUrls: () => string[]
  restore: () => void
} {
  const cacheRoot = mkdtempSync(join(tmpdir(), 'helix-hostile-desktop-no-egress-'))
  const refused: string[] = []
  const previous = getMainHttpClient()
  setMainHttpClient({
    fetch: async (url) => {
      refused.push(url)
      throw new Error('net::ERR_CONNECTION_REFUSED')
    },
    proxySession: () => null
  })
  return {
    cacheRoot,
    refusedUrls: () => refused,
    restore: () => {
      setMainHttpClient(previous)
      rmSync(cacheRoot, { recursive: true, force: true })
    }
  }
}
