import type {
  HelixCloudCapabilities,
  HelixCloudOrgSummary,
  HelixProfileCloudSummary
} from '../../shared/helix-profiles'
import type { HelixCloudAuthConfig } from './profile-cloud-auth-config'
import type { HelixCloudSession } from './profile-cloud-session-store'
import type { HelixCloudSessionExchangeResponse } from './profile-cloud-session-exchange'
import { cancelUnreadResponseBody } from '../lib/unread-response-body'

type ExchangeCodeArgs = {
  code: string
  codeVerifier: string
  nonce: string
  redirectUri: string
  state: string
  localProfileId: string
}

type CreateCloudProfileArgs = {
  orgId?: string
  name?: string
}

type SelectOrgResponse = {
  cloud: HelixProfileCloudSummary
  organizations?: HelixCloudOrgSummary[]
  capabilities: HelixCloudCapabilities
}

type CapabilityRefreshResponse = {
  cloud?: HelixProfileCloudSummary
  organizations?: HelixCloudOrgSummary[]
  capabilities: HelixCloudCapabilities
}

export class HelixCloudRequestError extends Error {
  // Preserve the server error discriminator so callers can distinguish business 4xx outcomes.
  constructor(
    public readonly statusCode: number,
    public readonly errorCode?: string
  ) {
    super(`helix_cloud_request_failed_${statusCode}`)
    this.name = 'HelixCloudRequestError'
  }
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`invalid_helix_cloud_${field}`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`invalid_helix_cloud_${field}`)
  }
  return trimmed
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

function assertNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`invalid_helix_cloud_${field}`)
  }
  return value
}

function normalizeCapabilities(value: unknown): HelixCloudCapabilities {
  if (!value || typeof value !== 'object') {
    return { flags: {}, refreshedAt: Date.now() }
  }
  const record = value as Record<string, unknown>
  const rawFlags = record.flags
  const flags: Record<string, boolean> = {}
  if (rawFlags && typeof rawFlags === 'object' && !Array.isArray(rawFlags)) {
    for (const [key, flag] of Object.entries(rawFlags)) {
      if (typeof flag === 'boolean') {
        flags[key] = flag
      }
    }
  }
  return {
    flags,
    refreshedAt:
      typeof record.refreshedAt === 'number' && Number.isFinite(record.refreshedAt)
        ? record.refreshedAt
        : Date.now()
  }
}

function normalizeOrganizations(value: unknown): HelixCloudOrgSummary[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const organizations: HelixCloudOrgSummary[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    if (typeof record.orgId !== 'string' || typeof record.name !== 'string') {
      continue
    }
    const orgId = record.orgId.trim()
    const name = record.name.trim()
    if (!orgId || !name) {
      continue
    }
    organizations.push({
      orgId,
      name,
      role: typeof record.role === 'string' && record.role.trim() ? record.role.trim() : undefined
    })
  }
  return organizations
}

function normalizeCloudSummary(value: unknown): HelixProfileCloudSummary {
  if (!value || typeof value !== 'object') {
    throw new Error('invalid_helix_cloud_profile')
  }
  const record = value as Record<string, unknown>
  return {
    cloudProfileId: assertString(record.cloudProfileId, 'profile_id'),
    userId: assertString(record.userId, 'user_id'),
    email: assertString(record.email, 'email'),
    displayName: optionalString(record.displayName),
    activeOrgId: optionalString(record.activeOrgId),
    activeOrgName: optionalString(record.activeOrgName),
    linkedAt:
      typeof record.linkedAt === 'number' && Number.isFinite(record.linkedAt)
        ? record.linkedAt
        : Date.now()
  }
}

function normalizeSessionResponse(value: unknown): HelixCloudSessionExchangeResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('invalid_helix_cloud_session')
  }
  const record = value as Record<string, unknown>
  return {
    accessToken: assertString(record.accessToken, 'access_token'),
    refreshToken: assertString(record.refreshToken, 'refresh_token'),
    expiresAt: assertNumber(record.expiresAt, 'expires_at'),
    cloud: normalizeCloudSummary(record.cloud),
    organizations: normalizeOrganizations(record.organizations),
    capabilities: normalizeCapabilities(record.capabilities)
  }
}

const CLOUD_REQUEST_TIMEOUT_MS = 30_000

// A lost rotating-token response makes retries ambiguous; one longer attempt avoids replay.
const CLOUD_REFRESH_TIMEOUT_MS = 60_000

type PostJsonOptions = {
  accessToken?: string
  timeoutMs?: number
}

// Without an explicit rejection, a rotating credential may already be spent.
export function isAmbiguousCloudRequestFailure(error: unknown): boolean {
  return !(error instanceof HelixCloudRequestError)
}

async function postJson<T>(url: string, body: unknown, options?: PostJsonOptions): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options?.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {})
    },
    body: JSON.stringify(body),
    // Redirects could leak rotating credentials; timeout bounds renderer IPC waits.
    redirect: 'error',
    signal: AbortSignal.timeout(options?.timeoutMs ?? CLOUD_REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) {
    await cancelUnreadResponseBody(response)
    throw new HelixCloudRequestError(response.status)
  }
  return (await response.json()) as T
}

export async function exchangeHelixCloudAuthCode(
  config: HelixCloudAuthConfig,
  args: ExchangeCodeArgs
): Promise<HelixCloudSessionExchangeResponse> {
  return normalizeSessionResponse(
    await postJson(config.sessionEndpoint, {
      code: args.code,
      codeVerifier: args.codeVerifier,
      nonce: args.nonce,
      redirectUri: args.redirectUri,
      state: args.state,
      localProfileId: args.localProfileId
    })
  )
}

export async function refreshHelixCloudCapabilities(
  config: HelixCloudAuthConfig,
  session: HelixCloudSession
): Promise<CapabilityRefreshResponse> {
  const response = await postJson<{
    cloud?: unknown
    organizations?: unknown
    capabilities: unknown
  }>(config.capabilitiesEndpoint, {}, { accessToken: session.accessToken })
  return {
    cloud: response.cloud === undefined ? undefined : normalizeCloudSummary(response.cloud),
    organizations: normalizeOrganizations(response.organizations),
    capabilities: normalizeCapabilities(response.capabilities)
  }
}

export async function refreshHelixCloudSession(
  config: HelixCloudAuthConfig,
  session: HelixCloudSession
): Promise<HelixCloudSessionExchangeResponse> {
  return normalizeSessionResponse(
    await postJson(
      config.refreshEndpoint,
      { refreshToken: session.refreshToken },
      { timeoutMs: CLOUD_REFRESH_TIMEOUT_MS }
    )
  )
}

export async function createHelixCloudProfile(
  config: HelixCloudAuthConfig,
  session: HelixCloudSession,
  args: CreateCloudProfileArgs
): Promise<HelixCloudSessionExchangeResponse> {
  return normalizeSessionResponse(
    await postJson(
      config.profileEndpoint,
      {
        orgId: args.orgId,
        name: args.name
      },
      { accessToken: session.accessToken }
    )
  )
}

export async function selectHelixCloudOrg(
  config: HelixCloudAuthConfig,
  session: HelixCloudSession,
  orgId: string
): Promise<SelectOrgResponse> {
  const response = await postJson<{
    cloud: unknown
    organizations?: unknown
    capabilities: unknown
  }>(config.orgEndpoint, { orgId }, { accessToken: session.accessToken })
  return {
    cloud: normalizeCloudSummary(response.cloud),
    organizations: normalizeOrganizations(response.organizations),
    capabilities: normalizeCapabilities(response.capabilities)
  }
}

export async function revokeHelixCloudSession(
  config: HelixCloudAuthConfig,
  session: HelixCloudSession
): Promise<void> {
  await postJson(
    config.logoutEndpoint,
    { refreshToken: session.refreshToken },
    { accessToken: session.accessToken }
  )
}
