import { test, expect } from './helpers/helix-app'
import { waitForSessionReady, waitForActiveWorktree } from './helpers/store'
import { seedLineageScenario } from './worktree-lineage-state'

test.use({ launchEnv: { HELIX_BACKGROUND_LAUNCH: '1' } })

test('locally controlled project-group modal keeps child-toggle input', async ({
  helixPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(helixPage)
  await waitForActiveWorktree(helixPage)
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every((window) => !window.isVisible())
    )
  ).toBe(true)
  const family = await seedLineageScenario(helixPage)
  const groupId = await helixPage.evaluate(async ({ parentId }) => {
    const store = window.__store
    if (!store) {
      throw new Error('Missing store')
    }
    const parent = Object.values(store.getState().worktreesByRepo)
      .flat()
      .find((row) => row.id === parentId)
    if (!parent) {
      throw new Error('Missing parent')
    }
    const group = await store.getState().createProjectGroup('Shortcut dialog group', 'local')
    if (!group) {
      throw new Error('Missing project group')
    }
    const parentRepo = store.getState().repos.find((repo) => repo.id === parent.repoId)
    if (!parentRepo) {
      throw new Error('Missing parent repo')
    }
    await store.getState().moveProjectToGroup(parentRepo, group.id)
    store.getState().setGroupBy('repo')
    await store.getState().setKeybindingOverride('sidebar.childWorkspaces.toggle', ['Mod+Alt+H'])
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyH') {
        document.body.dataset.childToggleClaimed = String(event.defaultPrevented)
      }
    })
    return group.id
  }, family)
  const group = helixPage.locator(`[data-project-group-header-id="${groupId}"]`)
  await expect(
    helixPage
      .locator(
        `[data-worktree-sidebar] [role="option"][data-worktree-id=${JSON.stringify(family.parentId)}]`
      )
      .first()
      .getByRole('button', { name: 'Hide 1 child workspace' })
  ).toBeVisible()
  await group.hover()
  await group.getByRole('button', { name: /Group actions/i }).click()
  // The menu is not a modal input owner.
  await helixPage.keyboard.press('ControlOrMeta+Alt+KeyH')
  expect(await helixPage.evaluate(() => window.__store?.getState().collapsedGroups.size)).toBe(1)
  await helixPage.keyboard.press('ControlOrMeta+Alt+KeyH')
  expect(await helixPage.evaluate(() => window.__store?.getState().collapsedGroups.size)).toBe(0)
  await helixPage.getByRole('menuitem', { name: /Delete/i }).click()
  const dialog = helixPage.getByRole('dialog', { name: 'Delete Project Group' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Delete Group', exact: true })).toBeFocused()
  expect(await helixPage.evaluate(() => window.__store?.getState().activeModal)).toBe('none')
  const before = await helixPage.evaluate(() =>
    [...(window.__store?.getState().collapsedGroups ?? [])].sort()
  )
  await helixPage.keyboard.press('ControlOrMeta+Alt+KeyH')
  const proof = testInfo.outputPath('local-modal-guard.png')
  await helixPage.screenshot({ path: proof })
  await testInfo.attach('local-modal-guard', { path: proof, contentType: 'image/png' })
  expect(
    await helixPage.evaluate(() => [...(window.__store?.getState().collapsedGroups ?? [])].sort())
  ).toEqual(before)
  await expect(helixPage.locator('body')).toHaveAttribute('data-child-toggle-claimed', 'false')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(
    helixPage
      .locator(
        `[data-worktree-sidebar] [role="option"][data-worktree-id=${JSON.stringify(family.childId)}]`
      )
      .first()
  ).toBeVisible()
})
