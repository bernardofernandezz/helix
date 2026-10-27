import { expect, test } from './helpers/helix-app'

for (const theme of ['dark', 'light'] as const) {
  test(`tab drag stays cancelled after blur and a later drag still splits (${theme})`, async ({
    helixPage
  }, testInfo) => {
    await helixPage.setViewportSize({ width: 1200, height: 900 })
    await helixPage.evaluate(async (theme) => {
      const state = window.__store!.getState()
      await state.updateSettingsOrThrow({ theme })
      const worktreeId = state.activeWorktreeId!
      const tabs = state.tabsByWorktree[worktreeId] ?? []
      for (let index = tabs.length; index < 2; index++) {
        state.createTab(worktreeId)
      }
    }, theme)

    const tabs = helixPage.locator('[data-testid="sortable-tab"]:visible')
    const panels = helixPage.locator('[data-tab-group-body-id]:visible')
    const preview = helixPage.getByText('New split', { exact: true })
    await expect(tabs).toHaveCount(2)
    await expect(panels).toHaveCount(1)
    const panel = (await panels.boundingBox())!
    const target = { x: panel.x + panel.width - 30, y: panel.y + panel.height / 2 }
    const startDrag = async (): Promise<void> => {
      const tab = (await tabs.first().boundingBox())!
      await helixPage.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2)
      await helixPage.mouse.down()
      await helixPage.mouse.move(target.x, target.y, { steps: 12 })
      await expect(preview).toBeVisible()
    }

    await startDrag()
    // Exercise the window event without changing native focus on the developer's desktop.
    await helixPage.evaluate(async () => {
      window.dispatchEvent(new Event('blur'))
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    await expect(preview).toHaveCount(0)
    await helixPage.mouse.move(target.x - 10, target.y + 10, { steps: 3 })

    const screenshot = testInfo.outputPath(`tab-drag-after-blur-${theme}.png`)
    await helixPage.screenshot({ path: screenshot, animations: 'disabled' })
    await testInfo.attach(`tab-drag-after-blur-${theme}`, {
      path: screenshot,
      contentType: 'image/png'
    })
    await expect(preview).toHaveCount(0)
    await helixPage.mouse.up()
    await expect(panels).toHaveCount(1)

    await startDrag()
    await helixPage.mouse.up()
    await expect(preview).toHaveCount(0)
    await expect(panels).toHaveCount(2)
  })
}
