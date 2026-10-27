import { retryTransientMainEvaluate } from './helpers/electron-main-evaluate-retry'
import { expect, test } from './helpers/helix-app'

test.use({ seedTestRepo: false })

test('shows one delayed-save notice, restores it after reload, and clears on recovery', async ({
  electronApp,
  helixPage
}, testInfo) => {
  expect(await helixPage.evaluate(() => window.api.app.isProfileStateSaveDelayed())).toBe(false)

  const setSaveDelayed = async (delayed: boolean): Promise<void> => {
    // Simulate the writer's status without stalling the app or touching real profile data.
    await retryTransientMainEvaluate(() =>
      electronApp.evaluate(({ ipcMain }, value) => {
        ipcMain.removeHandler('app:isProfileStateSaveDelayed')
        ipcMain.handle('app:isProfileStateSaveDelayed', () => value)
      }, delayed)
    )
    const window = await electronApp.browserWindow(helixPage)
    await window.evaluate((browserWindow, value) => {
      browserWindow.webContents.send('app:profileStateSaveDelayChanged', value)
    }, delayed)
    await window.dispose()
  }

  const notice = helixPage.locator('[data-sonner-toast]').filter({
    hasText: 'Profile storage is taking longer than usual'
  })
  await setSaveDelayed(true)
  await expect(notice).toHaveCount(1)
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Further saves may be delayed while this operation finishes.')
  await expect(notice.getByRole('button')).toHaveCount(0)
  await expect(notice).toHaveCSS('opacity', '1')
  const screenshot = testInfo.outputPath('delayed-save-notice.png')
  await helixPage.screenshot({ path: screenshot })
  await testInfo.attach('delayed-save-notice', { path: screenshot, contentType: 'image/png' })

  await setSaveDelayed(true)
  await expect(notice).toHaveCount(1)

  await helixPage.clock.install()
  await helixPage.clock.pauseAt(await helixPage.evaluate(() => Date.now() + 1_000))
  try {
    // Hold dismissal frames until the replacement warning has been published.
    await setSaveDelayed(false)
    await setSaveDelayed(true)
    await setSaveDelayed(true)
    await helixPage.clock.runFor(50)
    await expect(notice.and(helixPage.locator('[data-removed="true"]'))).toHaveCount(1)
    await helixPage.clock.runFor(400)
    await expect(notice).toHaveCount(1)
    await expect(notice).toBeVisible()
  } finally {
    await helixPage.clock.resume()
  }

  await helixPage.reload()
  await expect(notice).toBeVisible()
  expect(await helixPage.evaluate(() => window.api.app.isProfileStateSaveDelayed())).toBe(true)

  await setSaveDelayed(false)
  await expect(notice).toHaveCount(0)
})
