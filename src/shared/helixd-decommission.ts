import type { HelixdManagedRefusal } from './helixd-managed-runtime'
import type { HelixdDaemonRetirementVerdict } from './helixd-stop-request'

export type HelixdDecommissionResult =
  | {
      outcome: 'decommissioned'
      version: string
      /** The daemon's fate: `retired`, or kept with its terminals (`live`/`unverifiable`). */
      retirement: HelixdDaemonRetirementVerdict
    }
  | HelixdManagedRefusal
