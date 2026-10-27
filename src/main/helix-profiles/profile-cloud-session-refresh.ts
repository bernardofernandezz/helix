import type { HelixCloudAuthConfig } from './profile-cloud-auth-config'
import type { ActiveHelixProfileState } from './profile-index-store'
import { helixCloudSessionKey, type HelixCloudSession } from './profile-cloud-session-store'
import {
  isAmbiguousCloudRequestFailure,
  HelixCloudRequestError,
  refreshHelixCloudSession
} from './profile-cloud-client'
import type { HelixCloudSessionExchangeResponse } from './profile-cloud-session-exchange'
import {
  AmbiguousRefreshReplayBlockedError,
  blocksAmbiguousRefreshReplay,
  forgetAmbiguousRefreshAttempt,
  recordAmbiguousRefreshAttempt,
  wasRefreshTokenAmbiguouslyAttempted
} from './profile-cloud-refresh-replay-guard'
import { emitHelixCloudSessionInvalidated } from './profile-cloud-session-invalidation'
import {
  commitCloudSessionRotation,
  readCloudSession,
  signOutRevokedCloudSession,
  takeCloudSessionTicket
} from './profile-cloud-session-owner'

const CLOUD_SESSION_REFRESH_SKEW_MS = 60_000

export type FreshCloudSessionResult =
  | { status: 'found'; session: HelixCloudSession }
  | { status: 'reconnect-required' }

export type CloudSessionOperationResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'reconnect-required' }

function shouldRefreshCloudSession(session: HelixCloudSession, now = Date.now()): boolean {
  return session.expiresAt <= now + CLOUD_SESSION_REFRESH_SKEW_MS
}

export function isHelixCloudAuthFailure(error: unknown): boolean {
  return (
    error instanceof HelixCloudRequestError &&
    (error.statusCode === 401 || error.statusCode === 403)
  )
}

const inflightCloudSessionRefreshes = new Map<string, Promise<HelixCloudSession>>()

class StaleCloudSessionMutationError extends Error {
  constructor() {
    super('stale_cloud_session_mutation')
  }
}

function clearCloudSessionIfUnchanged(
  profileId: string,
  userDataPath: string,
  failed: HelixCloudSession
): void {
  if (!signOutRevokedCloudSession(profileId, userDataPath, failed)) {
    return
  }
  forgetAmbiguousRefreshAttempt(helixCloudSessionKey(profileId, userDataPath))
  // Invalidate the renderer’s cached Connected state immediately.
  emitHelixCloudSessionInvalidated()
}

// Distinguish genuine revocation from ambiguous refresh replay without logging tokens.
function warnIfPossibleRefreshReplay(
  profileId: string,
  userDataPath: string,
  failed: HelixCloudSession,
  error: unknown
): void {
  if (!(error instanceof HelixCloudRequestError) || error.statusCode !== 401) {
    return
  }
  const key = helixCloudSessionKey(profileId, userDataPath)
  if (!wasRefreshTokenAmbiguouslyAttempted(key, failed.refreshToken)) {
    return
  }
  console.warn(
    '[helix-cloud] helix_cloud_refresh_possible_replay: refresh rejected 401 for a token whose earlier attempt never answered'
  )
}

type CloudSessionRefreshAttempt =
  | { status: 'refreshed'; response: HelixCloudSessionExchangeResponse }
  | { status: 'rotated-elsewhere'; session: HelixCloudSession }

function isRetryableCloudRefreshRejection(error: unknown): boolean {
  return error instanceof HelixCloudRequestError && error.statusCode >= 500
}

async function attemptCloudSessionRefresh(
  key: string,
  config: HelixCloudAuthConfig,
  active: ActiveHelixProfileState,
  userDataPath: string,
  session: HelixCloudSession
): Promise<CloudSessionRefreshAttempt> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await refreshHelixCloudSession(config, session)
      forgetAmbiguousRefreshAttempt(key)
      return { status: 'refreshed', response }
    } catch (error) {
      const ambiguous = isAmbiguousCloudRequestFailure(error)
      if (ambiguous) {
        recordAmbiguousRefreshAttempt(key, session.refreshToken)
      }
      // Retry only explicit 5xx rejection; ambiguous failures may have spent the token.
      const retryable = !ambiguous && attempt === 0 && isRetryableCloudRefreshRejection(error)
      if (!ambiguous && !retryable) {
        throw error
      }
      // Reuse concurrent rotations instead of replaying the now-spent token.
      const current = readCloudSession(active.profile.id, userDataPath)
      if (current.status === 'found' && current.session.refreshToken !== session.refreshToken) {
        return { status: 'rotated-elsewhere', session: current.session }
      }
      if (ambiguous) {
        throw error
      }
    }
  }
}

async function refreshStoredCloudSession(
  config: HelixCloudAuthConfig,
  active: ActiveHelixProfileState,
  userDataPath: string,
  session: HelixCloudSession
): Promise<HelixCloudSession> {
  // Single-flight rotating tokens: a duplicate POST can revoke the whole family.
  const key = helixCloudSessionKey(active.profile.id, userDataPath)
  const inflight = inflightCloudSessionRefreshes.get(key)
  if (inflight) {
    return inflight
  }
  const task = (async () => {
    const current = readCloudSession(active.profile.id, userDataPath)
    if (current.status === 'found' && current.session.refreshToken !== session.refreshToken) {
      return current.session
    }
    if (!active.profile.cloud) {
      throw new StaleCloudSessionMutationError()
    }
    if (blocksAmbiguousRefreshReplay(key, session.refreshToken)) {
      throw new AmbiguousRefreshReplayBlockedError()
    }
    const linked = active.profile.cloud
    const ticket = takeCloudSessionTicket(active.profile.id, userDataPath)
    const attempt = await attemptCloudSessionRefresh(key, config, active, userDataPath, session)
    if (attempt.status === 'rotated-elsewhere') {
      return attempt.session
    }
    const refreshed = attempt.response
    if (
      refreshed.cloud.userId !== linked.userId ||
      refreshed.cloud.cloudProfileId !== linked.cloudProfileId
    ) {
      throw new StaleCloudSessionMutationError()
    }
    const saved = commitCloudSessionRotation(
      active.profile.id,
      userDataPath,
      ticket,
      session,
      refreshed
    )
    if (!saved) {
      throw new StaleCloudSessionMutationError()
    }
    return saved
  })()
  inflightCloudSessionRefreshes.set(key, task)
  try {
    return await task
  } finally {
    inflightCloudSessionRefreshes.delete(key)
  }
}

export async function readFreshHelixCloudSession(
  config: HelixCloudAuthConfig,
  active: ActiveHelixProfileState,
  userDataPath: string
): Promise<FreshCloudSessionResult> {
  const session = readCloudSession(active.profile.id, userDataPath)
  if (session.status !== 'found') {
    return { status: 'reconnect-required' }
  }
  if (!shouldRefreshCloudSession(session.session)) {
    return { status: 'found', session: session.session }
  }
  try {
    return {
      status: 'found',
      session: await refreshStoredCloudSession(config, active, userDataPath, session.session)
    }
  } catch (error) {
    if (isHelixCloudAuthFailure(error)) {
      warnIfPossibleRefreshReplay(active.profile.id, userDataPath, session.session, error)
      clearCloudSessionIfUnchanged(active.profile.id, userDataPath, session.session)
      return { status: 'reconnect-required' }
    }
    throw error
  }
}

export async function forceRefreshHelixCloudSession(
  config: HelixCloudAuthConfig,
  active: ActiveHelixProfileState,
  userDataPath: string,
  session: HelixCloudSession
): Promise<FreshCloudSessionResult> {
  try {
    return {
      status: 'found',
      session: await refreshStoredCloudSession(config, active, userDataPath, session)
    }
  } catch (error) {
    if (isHelixCloudAuthFailure(error)) {
      warnIfPossibleRefreshReplay(active.profile.id, userDataPath, session, error)
      clearCloudSessionIfUnchanged(active.profile.id, userDataPath, session)
      return { status: 'reconnect-required' }
    }
    throw error
  }
}

export async function runWithFreshHelixCloudSession<T>(
  config: HelixCloudAuthConfig,
  active: ActiveHelixProfileState,
  userDataPath: string,
  operation: (session: HelixCloudSession) => Promise<T>
): Promise<CloudSessionOperationResult<T>> {
  const session = await readFreshHelixCloudSession(config, active, userDataPath)
  if (session.status !== 'found') {
    return { status: 'reconnect-required' }
  }
  try {
    return { status: 'ok', value: await operation(session.session) }
  } catch (error) {
    if (!isHelixCloudAuthFailure(error)) {
      throw error
    }
    const refreshed = await forceRefreshHelixCloudSession(
      config,
      active,
      userDataPath,
      session.session
    )
    if (refreshed.status !== 'found') {
      return { status: 'reconnect-required' }
    }
    try {
      return { status: 'ok', value: await operation(refreshed.session) }
    } catch (retryError) {
      // Post-refresh 401 rejects the session; permission-only 403 must preserve it.
      if (retryError instanceof HelixCloudRequestError && retryError.statusCode === 401) {
        clearCloudSessionIfUnchanged(active.profile.id, userDataPath, refreshed.session)
        return { status: 'reconnect-required' }
      }
      throw retryError
    }
  }
}
