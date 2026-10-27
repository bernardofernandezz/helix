import { writeHelixdActivationRecord } from '../activation/helixd-activation-record-store'
import type { HelixdActivationRecoveryResult } from '../activation/helixd-activation-recovery'
import type { HelixdDecommissionRecoveryPlan } from './helixd-decommission-transaction'
import { settleHelixdDecommissionStop } from './helixd-decommission-stop'
import {
  helixdLivenessProbeCommand,
  helixdLivenessProvenExited,
  parseHelixdLiveness
} from '../install/helixd-remote-launch'
import { execHelixdRemote } from '../install/helixd-remote-runtime-control'
import {
  ensureHelixdSlotServing,
  helixdSlotDir,
  resolveHelixdSlotIdentity,
  type HelixdSlotOptions
} from '../../ssh/helixd-recovery-slot'

/** Only proven exit clears an interrupted decommission journal. */
export async function reconcileHelixdDecommission(
  options: HelixdSlotOptions,
  plan: HelixdDecommissionRecoveryPlan
): Promise<HelixdActivationRecoveryResult> {
  if (plan.action === 'keep-serving') {
    const identity = await resolveHelixdSlotIdentity(options, plan.version)
    return {
      outcome: 'recovered',
      resolution: 'restored-incumbent',
      activeVersion: plan.version,
      readiness: await ensureHelixdSlotServing(options, identity)
    }
  }
  if (plan.action === 'resume-stop') {
    const settlement = await settleHelixdDecommissionStop(options, plan.request)
    if (settlement.state === 'unsettled') {
      return {
        outcome: 'refused',
        verdict: settlement.verdict,
        code: 'helixd_recovery_decommission_unsettled',
        reason: settlement.reason
      }
    }
    if (settlement.state === 'withdrawn') {
      return reconcileHelixdDecommission(options, {
        action: 'keep-serving',
        version: plan.request.version
      })
    }
    return reconcileHelixdDecommission(options, {
      action: 'confirm-decommissioned',
      version: plan.request.version,
      record: plan.record
    })
  }
  // Live or unanswered slots retain the fence; only proven exit permits commit.
  const liveness = parseHelixdLiveness(
    await execHelixdRemote(
      options,
      helixdLivenessProbeCommand(options.host, helixdSlotDir(options, plan.version))
    )
  )
  if (!helixdLivenessProvenExited(liveness)) {
    return {
      outcome: 'refused',
      verdict: liveness === 'LIVE' ? 'live' : 'unverifiable',
      code: 'helixd_recovery_decommissioned_slot_not_exited',
      reason: `helixd ${plan.version} is recorded as stopped but is ${liveness.toLowerCase()}.`
    }
  }
  if (plan.record) {
    await writeHelixdActivationRecord(options, plan.record)
  }
  return { outcome: 'recovered', resolution: 'committed', activeVersion: null, readiness: null }
}
