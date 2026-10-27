import type { Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { test, expect } from './helpers/helix-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  waitForActiveTerminalManager,
  waitForPaneIdentitySnapshot,
  waitForTerminalOutput
} from './helpers/terminal'
import {
  assertInlineImagePixels,
  enableInlineImages,
  inlineImageProducer,
  readInlineImageResources,
  readInlineImageState
} from './helpers/terminal-inline-image-proof'
import { nodeTerminalCommand } from './terminal-node-command'

const TAB_COUNT = 12
const CYCLES = 2

test.use({ helixAppExtraArgs: ['--enable-precise-memory-info'] })

async function activateTab(page: Page, tabId: string): Promise<void> {
  await page.evaluate((id) => window.__store!.getState().setActiveTab(id), tabId)
  await expect.poll(() => page.evaluate(() => window.__store!.getState().activeTabId)).toBe(tabId)
  await waitForActiveTerminalManager(page, 30_000)
}

test('twelve image terminals release decoder and image storage across reset and close cycles', async ({
  helixPage
}, testInfo) => {
  test.setTimeout(360_000)
  await waitForSessionReady(helixPage)
  const worktreeId = await waitForActiveWorktree(helixPage)
  await ensureTerminalVisible(helixPage)
  await waitForActiveTerminalManager(helixPage, 30_000)
  await helixPage.evaluate(async () => {
    await window.__store!.getState().updateSettings({ terminalHiddenViewParking: false })
  })
  await enableInlineImages(helixPage)
  const baselineTabId = (await waitForPaneIdentitySnapshot(helixPage, 1)).tabId
  const producerPath = testInfo.outputPath('image-retention-producer.cjs')
  writeFileSync(
    producerPath,
    [
      inlineImageProducer(),
      'for (let id = 100; id < 106; id++) {',
      "process.stdout.write('\\x1b_Ga=t,f=32,s=1,v=1,i=' + id + ',m=1,q=2;AAAA\\x1b\\\\')",
      '}',
      "console.log('RETENTION_DONE_' + process.argv[2])"
    ].join('\n')
  )
  const cdp = await helixPage.context().newCDPSession(helixPage)
  const samples: unknown[] = []
  const sampleHeap = async () => {
    await cdp.send('HeapProfiler.collectGarbage')
    return cdp.send('Runtime.getHeapUsage')
  }
  const baseline = await sampleHeap()
  samples.push({ stage: 'baseline', heap: baseline })
  const outstandingTabs = new Set<string>()
  try {
    for (let cycle = 0; cycle < CYCLES; cycle++) {
      const tabs: { id: string; ptyId: string }[] = []
      for (let index = 0; index < TAB_COUNT; index++) {
        const id = await helixPage.evaluate((worktree) => {
          const state = window.__store!.getState()
          const tab = state.createTab(worktree, undefined, undefined, { activate: true })
          state.setActiveTab(tab.id)
          state.setActiveTabType('terminal', window.__store?.getState().activeWorktreeId ?? null)
          return tab.id
        }, worktreeId)
        outstandingTabs.add(id)
        await activateTab(helixPage, id)
        const identity = await waitForPaneIdentitySnapshot(helixPage, 1)
        expect(identity.tabId).toBe(id)
        const ptyId = identity.panes[0]?.ptyId
        if (!ptyId) {
          throw new Error('Image stress terminal did not bind its PTY')
        }
        tabs.push({ id, ptyId })
        await expect.poll(() => readInlineImageState(helixPage), { timeout: 30_000 }).not.toBeNull()
        const marker = `${cycle}_${index}`
        await execInTerminal(helixPage, ptyId, nodeTerminalCommand([producerPath, marker]))
        await waitForTerminalOutput(helixPage, `RETENTION_DONE_${marker}`, 30_000)
        await expect.poll(async () => (await readInlineImageState(helixPage))?.pending).toBe(2)
        if (index === TAB_COUNT - 1) {
          await assertInlineImagePixels(helixPage, testInfo.outputPath(`cycle-${cycle}-images.png`))
        }
      }
      const loaded = await readInlineImageResources(
        helixPage,
        tabs.map((tab) => tab.id)
      )
      expect(loaded).toHaveLength(TAB_COUNT)
      for (const resource of loaded) {
        expect(resource.mounted).toBe(true)
        expect(resource.addon).toBe(true)
        expect(resource.images).toBeGreaterThanOrEqual(3)
        expect(resource.pending).toBe(2)
        expect(resource.decoderBytes).toBeGreaterThan(0)
        expect(resource.decoderBytes).toBeLessThanOrEqual(32_000_000)
        expect(resource.blobBytes).toBeLessThanOrEqual(32_000_000)
        expect(resource.storageMB).toBeLessThanOrEqual(32)
      }
      samples.push({ stage: `cycle-${cycle}-loaded`, resources: loaded, heap: await sampleHeap() })
      for (const tab of tabs) {
        await activateTab(helixPage, tab.id)
        await execInTerminal(
          helixPage,
          tab.ptyId,
          nodeTerminalCommand([
            '-e',
            "process.stdout.write('\\x1bc'); console.log('RESET_' + 'DONE')"
          ])
        )
        await waitForTerminalOutput(helixPage, 'RESET_DONE', 30_000)
        await expect
          .poll(async () => {
            const [resource] = await readInlineImageResources(helixPage, [tab.id])
            return {
              images: resource.images,
              pending: resource.pending,
              decoderBytes: resource.decoderBytes,
              blobBytes: resource.blobBytes
            }
          })
          .toEqual({ images: 0, pending: 0, decoderBytes: 0, blobBytes: 0 })
      }
      samples.push({
        stage: `cycle-${cycle}-reset`,
        resources: await readInlineImageResources(
          helixPage,
          tabs.map((tab) => tab.id)
        ),
        heap: await sampleHeap()
      })
      await activateTab(helixPage, baselineTabId)
      for (const tab of tabs) {
        await helixPage.evaluate((id) => window.__store!.getState().closeTab(id), tab.id)
      }
      await expect
        .poll(
          async () =>
            (
              await readInlineImageResources(
                helixPage,
                tabs.map((tab) => tab.id)
              )
            ).filter((resource) => resource.mounted).length,
          { timeout: 30_000 }
        )
        .toBe(0)
      for (const tab of tabs) {
        outstandingTabs.delete(tab.id)
      }
      const closed = await sampleHeap()
      samples.push({ stage: `cycle-${cycle}-closed`, heap: closed })
      // GC heap/backing storage catch retained owners without requiring allocator RSS to fall.
      expect(closed.usedSize).toBeLessThanOrEqual(baseline.usedSize + 64_000_000)
      // Require the CDP field: silently missing metrics must not remove the leak check.
      expect(baseline.backingStorageSize).toBeDefined()
      expect(closed.backingStorageSize).toBeDefined()
      expect(closed.backingStorageSize!).toBeLessThanOrEqual(
        baseline.backingStorageSize! + 32_000_000
      )
    }
  } finally {
    for (const id of outstandingTabs) {
      await helixPage
        .evaluate((tab) => window.__store!.getState().closeTab(tab), id)
        .catch(() => undefined)
    }
    writeFileSync(testInfo.outputPath('memory-measurements.json'), JSON.stringify(samples, null, 2))
    await testInfo.attach('inline-image-retention-measurements', {
      body: JSON.stringify(samples, null, 2),
      contentType: 'application/json'
    })
    await cdp.detach()
  }
})
