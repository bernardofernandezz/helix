// an ~/.ssh/config host whose IdentityFile uses OpenSSH tokens connects with that key, not a password prompt.
// HELIX_E2E_HELIXD_CONVERT_HOST=docker; HELIX_E2E_HELIXD_CONVERT_TEMPLATE must be built for the Docker host.
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from './helpers/helix-app'
import { waitForSessionReady } from './helpers/store'
import { managedServer } from './helpers/helixd-convert-flow'
import { openSshHostSettings, seedIsolatedSshConfig } from './helpers/ssh-config-host-picker'
import {
  HELIXD_CONVERT_HOST_ENV,
  startHelixdConvertHost,
  type HelixdConvertHost
} from './helpers/helixd-convert-host'

const HOST = process.env[HELIXD_CONVERT_HOST_ENV]
const TEMPLATE_SOURCE = process.env.HELIX_E2E_HELIXD_CONVERT_TEMPLATE

test.skip(
  HOST !== 'docker' || !TEMPLATE_SOURCE,
  `Set ${HELIXD_CONVERT_HOST_ENV}=docker and HELIX_E2E_HELIXD_CONVERT_TEMPLATE`
)
test.use({
  seedTestRepo: false,
  helixAppExtraEnv: { HELIX_HELIXD_TEMPLATE_PATH: TEMPLATE_SOURCE ?? '', SSH_AUTH_SOCK: '' }
})

let host: HelixdConvertHost | null = null
let keyDir: string | null = null
test.afterEach(() => {
  host?.cleanup()
  host = null
  if (keyDir) {
    rmSync(keyDir, { recursive: true, force: true })
    keyDir = null
  }
})

test('an IdentityFile path with %r and %p tokens is the key Connect uses', async ({
  electronApp,
  helixPage
}, testInfo) => {
  // Starts a Docker host and installs Helix's server there.
  test.setTimeout(6 * 60_000)
  host = startHelixdConvertHost('docker', testInfo)
  keyDir = mkdtempSync(path.join(os.tmpdir(), 'helix-identity-tokens-'))
  // %r and %p expand to root and the mapped port; ssh -G prints them unexpanded.
  copyFileSync(host.input.identityFile!, path.join(keyDir, `id-root-${host.input.port}`))
  const alias = `helix-tokens-${host.input.port}`
  await seedIsolatedSshConfig(
    electronApp,
    [
      `Host ${alias}`,
      `  HostName ${host.input.host}`,
      `  Port ${host.input.port}`,
      '  User root',
      `  IdentityFile ${keyDir}/id-%r-%p`,
      '  IdentitiesOnly yes',
      ''
    ].join('\n')
  )
  await waitForSessionReady(helixPage)
  const targetId = await helixPage.evaluate(async (configHost) => {
    const { target } = await window.api.ssh.addTarget({
      target: {
        label: configHost,
        configHost,
        host: configHost,
        port: 22,
        username: '',
        source: 'ssh-config'
      }
    })
    return target.id
  }, alias)
  const section = await openSshHostSettings(helixPage)
  const card = section.locator(`[data-ssh-target-card][data-ssh-target-label="${alias}"]`)
  await card.hover()
  await card.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect
    .poll(() => managedServer(helixPage, targetId), { timeout: 4 * 60_000 })
    .toMatchObject({ kind: 'managed' })
  await expect(helixPage.getByRole('dialog', { name: 'SSH Password' })).toHaveCount(0)
})
