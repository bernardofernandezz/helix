import { HELIX_SESSION_ADDRESS_PREFIX } from '../../../../shared/helix-session-address'

/** Format bare ids as session addresses (NULL stays NULL); never strip addresses and risk matching handles or Runs. */
export function helixSessionAddressSql(helixSessionIdSql: string): string {
  return `('${HELIX_SESSION_ADDRESS_PREFIX}' || ${helixSessionIdSql})`
}
