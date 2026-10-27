// Journal instance-bound stop under the activation fence; refuse live/unknown terminal census and deactivate only after proven exit.
import { randomUUID } from 'node:crypto'
import type { HelixdActivationRecord } from '../activation/helixd-activation-record'
import {
  readHelixdActivationRecord,
  writeHelixdActivationRecord
} from '../activation/helixd-activation-record-store'
import { sameHelixdActivationRecord } from '../activation/helixd-activation-transaction'
import { writeHelixdActivationTransaction } from '../activation/helixd-activation-transaction-store'
import { withHelixdActivationLock } from '../activation/helixd-activation-lock'
import { helixdActivationFenceRefusal } from '../activation/helixd-activation-fence-hold'
import {
  committedHelixdDecommissionRecord,
  createHelixdDecommissionTransaction,
  withHelixdDecommissionProcessExited,
  withHelixdDecommissionStopDispatched
} from '../lifecycle/helixd-decommission-transaction'
import { readRemoteHelixdManagedStopTarget } from '../lifecycle/helixd-managed-remote-stop'
import { settleHelixdDecommissionStop } from '../lifecycle/helixd-decommission-stop'
import type { HelixdSlotOptions } from '../../ssh/helixd-recovery-slot'
import type { HelixdDecommissionResult } from '../../../shared/helixd-decommission'
import type { HelixdTerminalCensus } from '../../../shared/helixd-terminal-census'

type HelixdDecommissionOptions = HelixdSlotOptions & {
  /** Refuse if the host record changed since caller review. */
  record: HelixdActivationRecord
  /** Fresh census must prove no live or uncounted terminals. */
  census: HelixdTerminalCensus
  now?: () => Date
}

type Refusal = Extract<HelixdDecommissionResult, { outcome: 'refused' }>

function refuse(verdict: Refusal['verdict'], code: string, reason: string): Refusal {
  return { outcome: 'refused', verdict, code, reason }
}

function censusRefusal(census: HelixdTerminalCensus): Refusal | null {
  if (census.liveSessions === null) {
    return refuse(
      'unverifiable',
      'helixd_decommission_census_unavailable',
      'The terminal daemon did not answer a session count, so decommissioning could end ' +
        'running work. Retry when the host answers.'
    )
  }
  if (census.liveSessions > 0) {
    return refuse(
      'live',
      'helixd_decommission_terminals_running',
      `${census.liveSessions} terminal${census.liveSessions === 1 ? ' is' : 's are'} still ` +
        'running on this host. Close them before decommissioning the server.'
    )
  }
  return null
}

export async function decommissionRemoteHelixd(
  options: HelixdDecommissionOptions
): Promise<HelixdDecommissionResult> {
  const now = options.now ?? ((): Date => new Date())
  return withHelixdActivationLock(
    options,
    async (lock) => {
      const record = await readHelixdActivationRecord(options)
      if (!sameHelixdActivationRecord(record, options.record)) {
        return refuse(
          'unverifiable',
          'helixd_decommission_record_changed',
          'The host activation record changed since it was reviewed. Refresh and try again.'
        )
      }
      const activeVersion = record.active
      if (!activeVersion) {
        return refuse(
          'unverifiable',
          'helixd_decommission_nothing_active',
          'No helixd version is active on this host, so there is nothing to decommission.'
        )
      }
      const census = censusRefusal(options.census)
      if (census) {
        return census
      }
      const target = await readRemoteHelixdManagedStopTarget(options, activeVersion)
      if (target.state === 'refused') {
        return refuse(target.verdict, target.code, target.reason)
      }

      let transaction = createHelixdDecommissionTransaction({
        transactionId: randomUUID(),
        recordBefore: { ...record, active: activeVersion },
        now: now()
      })
      await writeHelixdActivationTransaction(options, transaction)
      lock.retainOnError()
      const request = {
        schemaVersion: 1 as const,
        transactionId: transaction.transactionId,
        ...target.context,
        // Idle daemon retirement is best-effort; busy daemons retain their terminals.
        retireIdleDaemon: true as const
      }
      // Journal exact stop intent before dispatch so recovery can settle the same request.
      transaction = withHelixdDecommissionStopDispatched(transaction, request, now())
      await writeHelixdActivationTransaction(options, transaction)

      const settlement = await settleHelixdDecommissionStop(options, request)
      if (settlement.state === 'withdrawn') {
        return refuse(settlement.verdict, 'helixd_decommission_stop_withdrawn', settlement.reason)
      }
      if (settlement.state === 'unsettled') {
        lock.retain()
        return refuse(settlement.verdict, 'helixd_decommission_stop_unsettled', settlement.reason)
      }
      transaction = withHelixdDecommissionProcessExited(transaction, now())
      await writeHelixdActivationTransaction(options, transaction)
      await writeHelixdActivationRecord(options, committedHelixdDecommissionRecord(transaction))
      return {
        outcome: 'decommissioned',
        version: activeVersion,
        retirement: settlement.retirement
      }
    },
    async () => {
      const refusal = await helixdActivationFenceRefusal(options, 'stop')
      return refuse('unverifiable', refusal.code, refusal.reason)
    }
  )
}
