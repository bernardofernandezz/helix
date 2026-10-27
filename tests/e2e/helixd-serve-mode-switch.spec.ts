// D7: switch Electron serve ↔ helixd serve on one profile without replacing surviving daemon terminals; each host must refuse the other’s profile lock.
// Build pnpm build:helixd, then run electron-headless with HELIX_E2E_HELIXD_SERVE=1 HELIX_BACKGROUND_LAUNCH=1.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runProcess } from '@helix/process-host'
import { getDaemonPidPath } from '../../src/main/daemon/daemon-spawner'
import { readDaemonPidRecord } from '../../src/main/daemon/daemon-endpoint-incarnation'
import { resolveBundledHelixdRuntime } from '../../src/main/helixd/helixd-bundled-runtime'
import { HELIXD_EXIT_CONFIGURATION } from '../../src/main/helixd/helixd-configuration-exit'
import {
  buildDaemonSessionClient,
  type DaemonSessionClientResult
} from '../../src/main/helixd/helixd-daemon-session-client-fixture'
import { expect, test } from './helpers/helix-app'
import { resolveElectronExecutable } from './helpers/daemon-generation-runtime-fixture'
import {
  launchHeadlessPairedRuntimeHost,
  type HeadlessPairedRuntimeHost
} from './helpers/headless-paired-runtime-host'
import { cleanupE2EDaemons } from './helpers/electron-process-shutdown'
import {
  cliServeProfile,
  isPidAlive,
  spawnUntilReady,
  startCliServe
} from './helpers/helix-serve-cli-host'

const RUN = process.env.HELIX_E2E_HELIXD_SERVE === '1'
const slotDir = path.resolve('out/helixd')
const helixdRuntime = RUN && existsSync(slotDir) ? resolveBundledHelixdRuntime(slotDir) : null
const SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE = 3

test.describe.configure({ mode: 'serial' })

let scratch = ''
let clientScript = ''

test.beforeAll(async () => {
  test.skip(
    !RUN,
    'Set HELIX_E2E_HELIXD_SERVE=1 (and build out/helixd) to run the serve mode switch.'
  )
  expect(helixdRuntime, 'pnpm build:helixd must produce a packaged slot in out/helixd').toBeTruthy()
  // Short root: macOS caps a unix socket path at 104 bytes, and the daemon's lives in userData.
  scratch = mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'helix-d7-'))
  clientScript = path.join(scratch, 'daemon-client.cjs')
  await buildDaemonSessionClient(clientScript)
})

test.afterAll(() => {
  if (scratch) {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 })
  }
})

function daemonPid(userDataDir: string): number | null {
  return readDaemonPidRecord(getDaemonPidPath(path.join(userDataDir, 'daemon')))?.pid ?? null
}

/** A paired client's terminal, straight to the profile's daemon, under this runner's Node. */
async function terminal(
  host: HeadlessPairedRuntimeHost,
  op: 'create' | 'attach',
  marker: string
): Promise<DaemonSessionClientResult> {
  const result = await runProcess({
    program: process.execPath,
    args: [clientScript, op, path.join(host.userDataDir, 'daemon'), 'serve-d7', marker, scratch],
    env: host.env,
    timeoutMs: 30_000
  })
  expect(result.code, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}')
}

type HelixdServe = { daemonPid: number; stop: () => Promise<void> }

/** `helix serve` on helixd, as the T6-11 launcher runs it, on the host's own profile. */
async function startHelixdServe(
  host: Pick<HeadlessPairedRuntimeHost, 'env' | 'userDataDir'>
): Promise<HelixdServe> {
  const serve = await spawnUntilReady({
    label: 'helixd serve',
    program: helixdRuntime!,
    args: [path.join(slotDir, 'helixd.js'), '--bind', '127.0.0.1', '--port', '0', '--json'],
    env: { ...host.env, HELIX_USER_DATA: host.userDataDir },
    timeoutMs: 120_000,
    parseReady: (stdout) => {
      const newline = stdout.indexOf('\n')
      return newline === -1 ? null : stdout.slice(0, newline)
    }
  })
  try {
    const daemon = JSON.parse(serve.ready).health?.terminalDaemon
    expect(daemon?.state, serve.stderr()).toBe('live')
    // POSIX: SIGTERM is helixd's graceful stop and leaves the daemon running by design.
    return { daemonPid: daemon.pid, stop: serve.stop }
  } catch (error) {
    // Why: the caller never gets stop(), and a leaked helixd keeps the profile lock.
    await serve.stop()
    throw error
  }
}

// Why: an SSH-managed helixd on this machine runs under ~/.helix, beside the desktop's own profile.
test("Electron serve starts beside a live daemon another profile's helixd forked", async () => {
  const other = cliServeProfile(scratch)
  const helixd = await startHelixdServe(other)
  try {
    const host = await launchHeadlessPairedRuntimeHost({
      pinnedServePort: true,
      userDataParent: scratch
    })
    try {
      expect(daemonPid(host.userDataDir)).not.toBe(helixd.daemonPid)
    } finally {
      await host.dispose()
    }
  } finally {
    await helixd.stop()
    await cleanupE2EDaemons(other.userDataDir)
  }
})

test('a terminal survives Electron serve → helixd serve → Electron serve on one profile', async () => {
  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    userDataParent: scratch
  })
  try {
    const created = await terminal(host, 'create', 'ELECTRON')
    expect(created).toMatchObject({ isReattach: false, output: true })
    const electronDaemon = daemonPid(host.userDataDir)
    expect(electronDaemon).toBeTruthy()

    await host.restartServeProcess({
      betweenProcesses: async () => {
        // Electron serve has quit; helixd serve takes the same profile and adopts its daemon.
        const helixd = await startHelixdServe(host)
        try {
          expect(helixd.daemonPid).toBe(electronDaemon)
          expect(await terminal(host, 'attach', 'HELIXD')).toEqual({
            pid: created.pid,
            isReattach: true,
            output: true
          })
        } finally {
          await helixd.stop()
        }
      }
    })

    // Back on Electron serve: still the same daemon and the same live terminal.
    expect(daemonPid(host.userDataDir)).toBe(electronDaemon)
    expect(await terminal(host, 'attach', 'BACK')).toEqual({
      pid: created.pid,
      isReattach: true,
      output: true
    })
  } finally {
    await host.dispose()
  }
})

test("Electron serve adopts a terminal helixd's daemon owns", async () => {
  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    userDataParent: scratch
  })
  try {
    let created: DaemonSessionClientResult | null = null
    let helixdDaemon: number | null = null
    await host.restartServeProcess({
      betweenProcesses: async () => {
        // Retire Electron's daemon so helixd serve forks its own on the pinned Node.
        const previous = daemonPid(host.userDataDir)
        if (previous) {
          process.kill(previous, 'SIGKILL')
          await expect.poll(() => isPidAlive(previous), { timeout: 10_000 }).toBe(false)
        }
        const helixd = await startHelixdServe(host)
        try {
          helixdDaemon = helixd.daemonPid
          expect(helixdDaemon).not.toBe(previous)
          created = await terminal(host, 'create', 'HELIXD')
          expect(created).toMatchObject({ isReattach: false, output: true })
        } finally {
          await helixd.stop()
        }
      }
    })
    expect(daemonPid(host.userDataDir)).toBe(helixdDaemon)
    expect(await terminal(host, 'attach', 'ELECTRON')).toEqual({
      pid: created!.pid,
      isReattach: true,
      output: true
    })
  } finally {
    await host.dispose()
  }
})

test('each serve host refuses a profile the other holds', async () => {
  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    userDataParent: scratch
  })
  try {
    // Electron serve holds the profile: helixd serve refuses with its configuration exit code.
    const refused = await runProcess({
      program: helixdRuntime!,
      args: [path.join(slotDir, 'helixd.js'), '--bind', '127.0.0.1', '--port', '0', '--json'],
      env: { ...host.env, HELIX_USER_DATA: host.userDataDir },
      timeoutMs: 60_000
    })
    expect(refused.code).toBe(HELIXD_EXIT_CONFIGURATION)
    expect(refused.stdout).toBe('')
    expect(refused.stderr).toContain('The Helix desktop app')

    await host.restartServeProcess({
      betweenProcesses: async () => {
        // helixd serve holds it: an Electron launch on the same profile exits as a duplicate.
        const helixd = await startHelixdServe(host)
        try {
          const electron = await runProcess({
            program: resolveElectronExecutable(process.cwd()),
            args: [...host.electronArgs, '--serve', '--serve-json', '--serve-port', '0'],
            env: host.env,
            timeoutMs: 90_000
          })
          expect(electron.code).toBe(SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE)
          expect(`${electron.stdout}${electron.stderr}`).toContain('Another helixd')
        } finally {
          await helixd.stop()
        }
      }
    })
  } finally {
    await host.dispose()
  }
})

/** Which host holds the profile: both take `helixd.lock`, each under its own role. */
function profileLockRole(userDataDir: string): unknown {
  return JSON.parse(readFileSync(path.join(userDataDir, 'helixd.lock'), 'utf8')).role
}

// Needs out/helixd-template for this runner's target, as a packaged install carries.
test('`helix serve` runs on helixd by default and on Electron with HELIX_SERVE_RUNTIME=electron', async () => {
  const profile = cliServeProfile(scratch)
  try {
    const byDefault = await startCliServe(profile)
    try {
      expect(byDefault.stderr()).toContain('[serve] running on helixd')
      expect(byDefault.readiness.health).toBeDefined()
      expect(profileLockRole(profile.userDataDir)).toBe('helixd')
    } finally {
      await byDefault.stop()
    }

    // Electron serve publishes no build-health block yet, which is what tells the two apart.
    const electron = await startCliServe(profile, { HELIX_SERVE_RUNTIME: 'electron' })
    try {
      expect(electron.stderr()).not.toContain('[serve] running on helixd')
      expect(electron.readiness.health).toBeUndefined()
    } finally {
      await electron.stop()
    }
  } finally {
    await cleanupE2EDaemons(profile.userDataDir)
  }
})
