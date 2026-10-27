import type { HelixdManagedStopRequest } from '../../shared/helixd-stop-request'
import { persistHelixdDaemonRetirementRecord } from './helixd-completed-stop-receipt'
import type { HelixdDaemonRetirement } from './helixd-daemon-retirement'
import { stopHelixdAutomationScheduler } from './helixd-automations'
import { holdHelixdTerminalAdmissionUntilExit } from './helixd-stop-terminal-admission'

// Keep daemon imports lazy so entry loading cannot initialize native code.
async function retireLazily(): Promise<HelixdDaemonRetirement> {
  const { retireHelixdDaemonIfIdle } = await import('./helixd-daemon-retirement')
  return retireHelixdDaemonIfIdle()
}

/** Record managed-stop outcomes without vetoing the stop. */
export async function prepareHelixdManagedStop(
  request: HelixdManagedStopRequest,
  retire: () => Promise<HelixdDaemonRetirement> = retireLazily,
  stopAutomations: () => void = stopHelixdAutomationScheduler,
  holdTerminalAdmission: () => void = holdHelixdTerminalAdmissionUntilExit
): Promise<void> {
  // Fence spawns before potentially slow daemon retirement.
  holdTerminalAdmission()
  // Stop dispatch before census so new runs cannot race shutdown.
  stopAutomations()
  if (!request.retireIdleDaemon) {
    return
  }
  const outcome = await retire().catch((error: unknown): HelixdDaemonRetirement => ({
    retirement: 'unverifiable',
    liveSessions: null,
    reason: `Retirement failed: ${error instanceof Error ? error.message : String(error)}`
  }))
  try {
    persistHelixdDaemonRetirementRecord(request, outcome)
  } catch (error) {
    // Missing retirement records remain unverifiable to the completion reader.
    console.error('[helixd] could not record daemon retirement:', error)
  }
}
