import type { Page } from '@playwright/test'
import { test, expect } from './helpers/helix-app'
import {
  moveTerminalPaneByLeafId,
  readPaneIdentitySnapshot,
  readTerminalPaneDomLeafOrder,
  splitActiveTerminalPane,
  waitForPaneIdentitySnapshot,
  waitForPaneCount
} from './helpers/terminal'
import { setPaneTitleFromTerminalMenu } from './helpers/terminal-pane-title-actions'
import { registerTerminalPaneMountReadiness } from './helpers/terminal-pane-mount-readiness'

async function expectPaneTitleAttachedToLeaf(
  page: Page,
  title: string,
  leafId: string
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ title, leafId }) => {
            const titleBar = Array.from(
              document.querySelectorAll<HTMLElement>('.pane-title-bar')
            ).find((element) => element.textContent?.includes(title))
            const pane = document.querySelector<HTMLElement>(`.pane[data-leaf-id="${leafId}"]`)
            if (!titleBar || !pane) {
              return false
            }
            const titleRect = titleBar.getBoundingClientRect()
            const paneRect = pane.getBoundingClientRect()
            return (
              Math.abs(titleRect.left - paneRect.left) < 1 &&
              Math.abs(titleRect.top - paneRect.top) < 1 &&
              Math.abs(titleRect.width - paneRect.width) < 1
            )
          },
          { title, leafId }
        ),
      {
        timeout: 5_000,
        message: 'Pane title overlay did not stay attached to its pane'
      }
    )
    .toBe(true)
}

// Serialize headful scenarios; visible-window runs require an isolated display.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  test('Set Title strip accepts file-path drops without changing the active pane', async ({
    helixPage
  }) => {
    const title = `Drop target title ${Date.now()}`
    const droppedPath = `/tmp/title-drop-${Date.now()}.txt`

    await setPaneTitleFromTerminalMenu(helixPage, title)
    const initialSnapshot = await waitForPaneIdentitySnapshot(helixPage, 1)
    const titledLeafId = initialSnapshot.activeLeafId ?? initialSnapshot.panes[0]?.leafId
    if (!titledLeafId) {
      throw new Error('No titled pane leaf id found before split')
    }

    await splitActiveTerminalPane(helixPage, 'vertical')
    await waitForPaneCount(helixPage, 2)
    const splitSnapshot = await waitForPaneIdentitySnapshot(helixPage, 2)
    const otherPane = splitSnapshot.panes.find((pane) => pane.leafId !== titledLeafId)
    if (!otherPane) {
      throw new Error('No inactive pane found for title-strip drop test')
    }

    await helixPage.evaluate(
      ({ tabId, paneId }) => {
        window.__paneManagers?.get(tabId)?.setActivePane(paneId, { focus: false })
      },
      { tabId: splitSnapshot.tabId, paneId: otherPane.numericPaneId }
    )
    await expect
      .poll(async () => (await readPaneIdentitySnapshot(helixPage))?.activeLeafId ?? null)
      .toBe(otherPane.leafId)

    const titleBar = helixPage.locator('.pane-title-bar', { hasText: title }).first()
    await expect(titleBar).toHaveAttribute('data-os-file-drop-owner', '')
    await expect(titleBar).toHaveAttribute('data-terminal-tab-id', splitSnapshot.tabId)

    await titleBar.evaluate((element, path) => {
      const dataTransfer = new DataTransfer()
      dataTransfer.setData('text/x-helix-file-path', path)
      // Internal drops are refused without the source owner an Explorer drag records.
      dataTransfer.setData(
        'application/x-helix-workspace-file-source',
        JSON.stringify({
          executionHostId: 'local',
          workspaceId: window.__store?.getState().activeWorktreeId,
          version: 1
        })
      )
      element.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer })
      )
      element.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })
      )
    }, droppedPath)

    await expect
      .poll(
        () =>
          helixPage.evaluate(
            ({ tabId, targetLeafId, otherLeafId, droppedPath }) => {
              const manager = window.__paneManagers?.get(tabId)
              const panes = manager?.getPanes() ?? []
              const content = (leafId: string) =>
                panes.find((pane) => pane.leafId === leafId)?.serializeAddon?.serialize() ?? ''
              return {
                activeLeafId: manager?.getActivePane()?.leafId ?? null,
                targetHasPath: content(targetLeafId).includes(droppedPath),
                otherHasPath: content(otherLeafId).includes(droppedPath)
              }
            },
            {
              tabId: splitSnapshot.tabId,
              targetLeafId: titledLeafId,
              otherLeafId: otherPane.leafId,
              droppedPath
            }
          ),
        { timeout: 5_000, message: 'Title-strip drop changed selection or missed its target' }
      )
      .toEqual({ activeLeafId: otherPane.leafId, targetHasPath: true, otherHasPath: false })
  })

  test('Set Title overlay follows its pane after same-count pane move', async ({ helixPage }) => {
    const title = `Moved overlay title ${Date.now()}`

    await setPaneTitleFromTerminalMenu(helixPage, title)
    const initialSnapshot = await waitForPaneIdentitySnapshot(helixPage, 1)
    const titledLeafId = initialSnapshot.activeLeafId ?? initialSnapshot.panes[0]?.leafId
    if (!titledLeafId) {
      throw new Error('No titled pane leaf id found before move')
    }

    await splitActiveTerminalPane(helixPage, 'vertical')
    await waitForPaneCount(helixPage, 2)
    const beforeMove = await waitForPaneIdentitySnapshot(helixPage, 2)
    const target = beforeMove.panes.find((pane) => pane.leafId !== titledLeafId)
    if (!target) {
      throw new Error('No target pane found for titled pane move')
    }
    const beforeOrder = await readTerminalPaneDomLeafOrder(helixPage)

    await expectPaneTitleAttachedToLeaf(helixPage, title, titledLeafId)
    await moveTerminalPaneByLeafId(helixPage, titledLeafId, target.leafId, 'right')

    await expect
      .poll(async () => readTerminalPaneDomLeafOrder(helixPage), {
        timeout: 10_000,
        message: 'Pane move did not update DOM order'
      })
      .not.toEqual(beforeOrder)
    await expectPaneTitleAttachedToLeaf(helixPage, title, titledLeafId)
  })

  test('Set Title keeps the pane drag handle available over the title strip', async ({
    helixPage
  }) => {
    const title = `Draggable title ${Date.now()}`

    await setPaneTitleFromTerminalMenu(helixPage, title)
    const initialSnapshot = await waitForPaneIdentitySnapshot(helixPage, 1)
    const titledLeafId = initialSnapshot.activeLeafId ?? initialSnapshot.panes[0]?.leafId
    if (!titledLeafId) {
      throw new Error('No titled pane leaf id found before split')
    }

    await splitActiveTerminalPane(helixPage, 'vertical')
    await waitForPaneCount(helixPage, 2)
    await expectPaneTitleAttachedToLeaf(helixPage, title, titledLeafId)

    const titleTopHit = await helixPage.evaluate(
      ({ title, titledLeafId }) => {
        const titleBar = Array.from(document.querySelectorAll<HTMLElement>('.pane-title-bar')).find(
          (element) => element.textContent?.includes(title)
        )
        const titleDragHandle =
          titleBar?.querySelector<HTMLElement>('.pane-title-drag-handle') ?? null
        const pane = document.querySelector<HTMLElement>(`.pane[data-leaf-id="${titledLeafId}"]`)
        if (!titleBar || !pane || !titleDragHandle) {
          return null
        }
        const titleRect = titleBar.getBoundingClientRect()
        const hitElement = document.elementFromPoint(
          titleRect.left + titleRect.width / 2,
          titleRect.top + 4
        )
        return {
          hitDragHandle:
            hitElement instanceof HTMLElement &&
            hitElement.closest('.pane-title-drag-handle') !== null,
          pointerEvents: getComputedStyle(titleDragHandle).pointerEvents,
          titleTop: titleRect.top,
          handleTop: titleDragHandle.getBoundingClientRect().top
        }
      },
      { title, titledLeafId }
    )

    expect(titleTopHit).not.toBeNull()
    expect(titleTopHit?.hitDragHandle).toBe(true)
    expect(titleTopHit?.pointerEvents).toBe('auto')
    expect(Math.abs((titleTopHit?.handleTop ?? 0) - (titleTopHit?.titleTop ?? 0))).toBeLessThan(1)

    await helixPage.locator('.pane-title-bar', { hasText: title }).click({
      position: { x: 20, y: 18 }
    })
    await expect(helixPage.locator('.pane-title-input')).toBeVisible()
  })

  test('@headful Set Title pane can be dragged from the title strip', async ({ helixPage }) => {
    const title = `Dragged title ${Date.now()}`

    await setPaneTitleFromTerminalMenu(helixPage, title)
    const initialSnapshot = await waitForPaneIdentitySnapshot(helixPage, 1)
    const titledLeafId = initialSnapshot.activeLeafId ?? initialSnapshot.panes[0]?.leafId
    if (!titledLeafId) {
      throw new Error('No titled pane leaf id found before drag')
    }

    await splitActiveTerminalPane(helixPage, 'vertical')
    await waitForPaneCount(helixPage, 2)
    const beforeDrag = await waitForPaneIdentitySnapshot(helixPage, 2)
    const target = beforeDrag.panes.find((pane) => pane.leafId !== titledLeafId)
    if (!target) {
      throw new Error('No target pane found for titled pane drag')
    }
    const beforeOrder = await readTerminalPaneDomLeafOrder(helixPage)

    const titleDragHandle = helixPage
      .locator('.pane-title-bar', { hasText: title })
      .locator('.pane-title-drag-handle')
    await expect(titleDragHandle).toBeVisible({ timeout: 3_000 })
    const sourceBox = await titleDragHandle.boundingBox()
    const targetBox = await helixPage
      .locator(`.pane[data-leaf-id="${target.leafId}"]`)
      .boundingBox()
    expect(sourceBox).not.toBeNull()
    expect(targetBox).not.toBeNull()
    const sourceIndex = beforeOrder.indexOf(titledLeafId)
    const targetIndex = beforeOrder.indexOf(target.leafId)
    const targetDropX =
      sourceIndex < targetIndex ? targetBox!.x + targetBox!.width - 8 : targetBox!.x + 8

    await helixPage.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + 4)
    await helixPage.mouse.down()
    await helixPage.mouse.move(targetDropX, targetBox!.y + targetBox!.height / 2, {
      steps: 20
    })
    await helixPage.mouse.up()

    await expect
      .poll(async () => readTerminalPaneDomLeafOrder(helixPage), {
        timeout: 10_000,
        message: 'Title-strip pane drag did not update DOM order'
      })
      .not.toEqual(beforeOrder)
    const afterDrag = await waitForPaneIdentitySnapshot(helixPage, 2)
    expect(afterDrag.panes.map((pane) => pane.leafId).sort()).toEqual(
      beforeDrag.panes.map((pane) => pane.leafId).sort()
    )
    await expectPaneTitleAttachedToLeaf(helixPage, title, titledLeafId)
  })
})
