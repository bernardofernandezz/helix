import { HELIXD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/helixd-managed-launch-env'

type HelixdWsPortOptions = {
  wsPort?: number
  preferPinnedWsPort?: boolean
  requirePinnedWsPort?: boolean
}

/** Honor explicit ports; managed launches permit fallback because WSL distros share loopback. */
export function helixdWsPortOptions(
  port: number | undefined,
  env: NodeJS.ProcessEnv = process.env
): HelixdWsPortOptions {
  if (port === undefined) {
    return {}
  }
  const managed = Boolean(env[HELIXD_MANAGED_ACTIVATION_ROOT_ENV])
  return {
    wsPort: port,
    preferPinnedWsPort: true,
    ...(managed ? {} : { requirePinnedWsPort: true })
  }
}
