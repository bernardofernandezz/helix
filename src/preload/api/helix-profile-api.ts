import type {
  HelixCloudSignInProgress,
  ConnectCurrentHelixProfileResult,
  CreateCloudLinkedHelixProfileArgs,
  CreateCloudLinkedHelixProfileResult,
  CreateLocalHelixProfileArgs,
  CreateLocalHelixProfileResult,
  FindHelixProfileProjectsByPathArgs,
  FindHelixProfileProjectsByPathResult,
  HelixProfileAuthStatus,
  HelixProfileListResult,
  HelixProfileOrgInviteRevokeArgs,
  HelixProfileOrgMemberChangeRoleArgs,
  HelixProfileOrgMemberInviteArgs,
  HelixProfileOrgMemberMutationResult,
  HelixProfileOrgMemberRemoveArgs,
  HelixProfileOrgMembersListArgs,
  HelixProfileOrgMembersListResult,
  RefreshCurrentHelixProfileAuthResult,
  SelectHelixProfileOrgArgs,
  SelectHelixProfileOrgResult,
  SignOutCurrentHelixProfileResult,
  SwitchHelixProfileArgs,
  SwitchHelixProfileResult,
  TransferHelixProfileProjectArgs,
  TransferHelixProfileProjectResult
} from '../../shared/helix-profiles'

export type HelixProfileApi = {
  list: () => Promise<HelixProfileListResult>
  authStatus: () => Promise<HelixProfileAuthStatus>
  /** Fires when main changed the stored auth status on its own (e.g. a revoked session). */
  onAuthStatusChanged: (callback: () => void) => () => void
  createLocal: (args?: CreateLocalHelixProfileArgs) => Promise<CreateLocalHelixProfileResult>
  createCloudLinked: (
    args?: CreateCloudLinkedHelixProfileArgs
  ) => Promise<CreateCloudLinkedHelixProfileResult>
  switchProfile: (args: SwitchHelixProfileArgs) => Promise<SwitchHelixProfileResult>
  transferProject: (
    args: TransferHelixProfileProjectArgs
  ) => Promise<TransferHelixProfileProjectResult>
  findProjectProfiles: (
    args: FindHelixProfileProjectsByPathArgs
  ) => Promise<FindHelixProfileProjectsByPathResult>
  connectCurrent: () => Promise<ConnectCurrentHelixProfileResult>
  signInProgress: () => Promise<HelixCloudSignInProgress | null>
  onSignInProgressChanged: (
    callback: (progress: HelixCloudSignInProgress | null) => void
  ) => () => void
  cancelSignIn: () => Promise<void>
  refreshAuth: () => Promise<RefreshCurrentHelixProfileAuthResult>
  signOutCurrent: () => Promise<SignOutCurrentHelixProfileResult>
  selectOrg: (args: SelectHelixProfileOrgArgs) => Promise<SelectHelixProfileOrgResult>
  orgMembersList: (
    args: HelixProfileOrgMembersListArgs
  ) => Promise<HelixProfileOrgMembersListResult>
  orgMemberInvite: (
    args: HelixProfileOrgMemberInviteArgs
  ) => Promise<HelixProfileOrgMemberMutationResult>
  orgInviteRevoke: (
    args: HelixProfileOrgInviteRevokeArgs
  ) => Promise<HelixProfileOrgMemberMutationResult>
  orgMemberChangeRole: (
    args: HelixProfileOrgMemberChangeRoleArgs
  ) => Promise<HelixProfileOrgMemberMutationResult>
  orgMemberRemove: (
    args: HelixProfileOrgMemberRemoveArgs
  ) => Promise<HelixProfileOrgMemberMutationResult>
}
