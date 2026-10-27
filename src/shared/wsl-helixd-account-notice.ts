/** Main → renderer: a WSL distro's helixd started an agent without the selected managed account,
 *  because it predates `agent-session.account-env.v1`. Sent at most once per distro per run. */
export const WSL_HELIXD_ACCOUNT_NOT_APPLIED_CHANNEL = 'runtimeEnvironments:wslAccountNotApplied'

export type WslHelixdAccountNotAppliedEvent = { distro: string }
