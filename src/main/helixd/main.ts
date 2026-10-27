import process from 'node:process'
import { main } from './helixd-entry'
import { resolveHelixdExitCode } from './helixd-exit-code'
import { reserveServeStdoutForReadiness } from '../server/serve-stdout-boundary'
import { runHelixdNativePreflight } from './helixd-native-preflight'
import {
  HELIXD_PROFILE_PREFLIGHT_FLAG,
  HELIXD_STARTUP_PREFLIGHT_FLAG
} from '../../shared/helixd-profile-preflight'
import {
  preflightBundledHelixdStartup,
  runHelixdProfilePreflight
} from './helixd-profile-preflight'
import { assertHelixdServerRuntime } from './helixd-bundled-runtime'
import {
  formatHelixdNativePreflightReport,
  HELIXD_NATIVE_PREFLIGHT_FLAG
} from '../../shared/helixd-native-preflight-report'
import {
  HELIXD_CANCEL_MANAGED_STOP_FLAG,
  HELIXD_COMPLETE_MANAGED_STOP_FLAG
} from '../../shared/helixd-stop-request'
import {
  HELIXD_WINDOWS_BREAKAWAY_CONTRACT,
  WINDOWS_BREAKAWAY_LAUNCH_FLAG
} from '../../shared/windows-breakaway-launch'
import { runWindowsBreakawayLaunchIfRequested } from '../../shared/windows-breakaway-launcher'
import { parseArgs } from './helixd-command-arguments'
import { HELIXD_RECLAIM_STALE_LOCK_FLAG } from '../../shared/helixd-stale-lock-reclaim'

// A resolved plain-Node module graph proves the build guard; skip probes, ports and data-root locks.
if (process.argv.includes('--helixd-smoke-load-check')) {
  process.exit(0)
}

function failStartup(error: unknown): void {
  console.error('helixd: failed to start:', error)
  // Distinguish configuration refusals so supervisors cannot restart-spin on them.
  process.exit(resolveHelixdExitCode(error))
}

// One-shot launch and stop commands must skip server startup and preflights.
if (process.argv[2] === '--helixd-structured-provider-load-check') {
  void import('./helixd-structured-provider-smoke')
    .then(({ smokeLoadHelixdStructuredProviders }) => smokeLoadHelixdStructuredProviders())
    .then(() => process.exit(0))
    .catch(failStartup)
} else if (process.argv[2] === WINDOWS_BREAKAWAY_LAUNCH_FLAG) {
  runWindowsBreakawayLaunchIfRequested(HELIXD_WINDOWS_BREAKAWAY_CONTRACT, process.argv)
} else if (
  process.argv[2] === HELIXD_COMPLETE_MANAGED_STOP_FLAG ||
  process.argv[2] === HELIXD_CANCEL_MANAGED_STOP_FLAG
) {
  void import('./helixd-managed-stop-command').then(({ runHelixdManagedStopCommandAndExit }) =>
    runHelixdManagedStopCommandAndExit(process.argv.slice(2))
  )
} else if (process.argv[2] === HELIXD_RECLAIM_STALE_LOCK_FLAG) {
  void import('./helixd-stale-lock-reclaim').then(({ runHelixdStaleLockReclaimCommandAndExit }) =>
    runHelixdStaleLockReclaimCommandAndExit(process.argv.slice(2))
  )
} else {
  startHelixdProcess()
}

function startHelixdProcess(): void {
  try {
    const argv = process.argv.slice(2)
    if ((argv.includes('--help') || argv.includes('-h')) && parseArgs(argv).help) {
      void main(argv).catch(failStartup)
      return
    }
    assertHelixdServerRuntime()
    const flag = process.argv[2]
    if (flag === HELIXD_NATIVE_PREFLIGHT_FLAG && process.argv.length === 3) {
      void import('./node-pty-precondition').then(({ checkNodePtyPrecondition }) => {
        const verdict = checkNodePtyPrecondition()
        const report = formatHelixdNativePreflightReport(verdict.status, verdict.reason ?? null)
        process.stdout.write(`${report}\n`, () => process.exit(0))
      }, failStartup)
    } else if (
      (flag === HELIXD_PROFILE_PREFLIGHT_FLAG || flag === HELIXD_STARTUP_PREFLIGHT_FLAG) &&
      process.argv.length === 4
    ) {
      void runHelixdProfilePreflight(process.argv[3], {
        nativeFeatures: flag === HELIXD_PROFILE_PREFLIGHT_FLAG
      })
        // The owner reads EOF; lingering native handles must not keep this probe alive.
        .then(() => process.stdout.write('', () => process.exit(0)))
        .catch(failStartup)
    } else {
      // Stdout is the readiness API; send incidental diagnostics to stderr.
      reserveServeStdoutForReadiness()
      void preflightBundledHelixdStartup()
        .then(() => {
          // Probe before deferred node-pty loading can crash this process.
          runHelixdNativePreflight()
          return main()
        })
        .catch(failStartup)
    }
  } catch (error) {
    failStartup(error)
  }
}
