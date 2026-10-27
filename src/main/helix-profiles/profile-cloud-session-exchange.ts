import type {
  HelixCloudCapabilities,
  HelixCloudOrgSummary,
  HelixProfileCloudSummary
} from '../../shared/helix-profiles'

export type HelixCloudSessionExchangeResponse = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  cloud: HelixProfileCloudSummary
  organizations?: HelixCloudOrgSummary[]
  capabilities: HelixCloudCapabilities
}
