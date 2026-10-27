import { z } from 'zod'

export const HELIXD_PROFILE_PREFLIGHT_FLAG = '--helixd-profile-state-preflight'
export const HELIXD_STARTUP_PREFLIGHT_FLAG = '--helixd-startup-preflight'
export const HELIXD_PROFILE_PREFLIGHT_TIMEOUT_MS = 90_000
// Server startup follows the disposable native/SQLite probe on every bundled launch.
export const HELIXD_STARTUP_READINESS_TIMEOUT_MS = HELIXD_PROFILE_PREFLIGHT_TIMEOUT_MS + 90_000

export const HELIXD_PREFLIGHT_RUNTIMES = ['node', 'bun'] as const

/** The runtime the caller launched; the candidate must prove it ran under exactly this one. */
export type HelixdPreflightRuntimeIdentity = {
  runtime: (typeof HELIXD_PREFLIGHT_RUNTIMES)[number]
  runtimeVersion: string
}

export const helixdProfilePreflightResponseSchema = z.object({
  type: z.literal('helix_profile_state_ready'),
  nonce: z.string().uuid(),
  runtime: z.enum(HELIXD_PREFLIGHT_RUNTIMES),
  runtimeVersion: z.string().min(1),
  artifactVersion: z.string().regex(/^\d+\.\d+\.\d+\+[a-f0-9]{12}$/),
  sqliteVersion: z.string().min(1),
  revision: z.number().int().positive()
})

export type HelixdProfilePreflightResponse = z.infer<typeof helixdProfilePreflightResponseSchema>

/** A fresh challenge prevents stale or unrelated output from admitting a candidate. */
export function parseHelixdProfilePreflight(
  output: string,
  nonce: string,
  expected: HelixdPreflightRuntimeIdentity,
  artifactVersion?: string
): HelixdProfilePreflightResponse {
  const response = helixdProfilePreflightResponseSchema.parse(JSON.parse(output.trim()))
  if (
    response.nonce !== nonce ||
    response.runtime !== expected.runtime ||
    response.runtimeVersion !== expected.runtimeVersion ||
    (artifactVersion !== undefined && response.artifactVersion !== artifactVersion)
  ) {
    throw new Error('Profile preflight did not run under the expected candidate runtime')
  }
  return response
}
