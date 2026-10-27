import { expect, test } from './helpers/helix-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { crashGuestRenderer } from './browser-guest-runtime-oracle'
import { observeBrowserLoadingSurface } from './browser-loading-surface-oracle'

test('browser host follows the theme before content and preserves the webpage canvas', async ({
  helixPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(helixPage)
  await ensureTerminalVisible(helixPage)
  await waitForActiveWorktree(helixPage)
  const observations = await observeBrowserLoadingSurface(
    helixPage,
    (name) => testInfo.outputPath(name),
    async (id) => {
      await crashGuestRenderer(electronApp, id)
    }
  )
  expect(observations.filter((entry) => !entry.pass)).toEqual([])
})
