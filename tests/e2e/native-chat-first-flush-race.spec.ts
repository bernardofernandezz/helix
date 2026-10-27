import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/helix-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActiveTerminalManager } from './helpers/terminal'
import {
  enableNativeChatSetting,
  seedClaudeProviderSession,
  toggleTerminalTabToChatView,
  claudeTranscriptLines
} from './helpers/native-chat-transcript-fixture'

const LOADING_TITLE = 'Loading conversation…'
const ERROR_TITLE = 'Could not load conversation'

test.describe('Native chat first-flush transcript race', () => {
  test('stays in loading (never errors) until a not-yet-flushed transcript appears, then hydrates live', async ({
    helixPage
  }, testInfo) => {
    await waitForSessionReady(helixPage)
    await waitForActiveWorktree(helixPage)
    await ensureTerminalVisible(helixPage)
    await waitForActiveTerminalManager(helixPage, 30_000)

    const descriptor = await waitForActivePaneHookDescriptor(helixPage)
    const [tabId] = descriptor.paneKey.split(':')
    const sessionId = `e2e-first-flush-${randomUUID()}`

    // Claude may flush its first JSONL minutes after launch; resolve providerSession before creating the file.
    const scratchDir = mkdtempSync(path.join(os.tmpdir(), 'helix-e2e-native-chat-'))
    const transcriptPath = path.join(scratchDir, `${sessionId}.jsonl`)

    const screenshotDir = testInfo.outputPath('screenshots')
    mkdirSync(screenshotDir, { recursive: true })
    await testInfo.attach('validation-screenshot-dir', {
      body: screenshotDir,
      contentType: 'text/plain'
    })

    try {
      await enableNativeChatSetting(helixPage)
      await seedClaudeProviderSession(helixPage, {
        paneKey: descriptor.paneKey,
        worktreeId: descriptor.worktreeId,
        sessionId,
        transcriptPath
      })
      await toggleTerminalTabToChatView(helixPage, { tabId, worktreeId: descriptor.worktreeId })

      await expect(helixPage.locator('[data-native-chat-root="true"]')).toBeVisible({
        timeout: 15_000
      })
      await expect(helixPage.getByText(LOADING_TITLE)).toBeVisible({ timeout: 10_000 })
      await expect(helixPage.getByText(ERROR_TITLE)).toHaveCount(0)
      await helixPage.screenshot({
        path: path.join(screenshotDir, '01-loading-no-error.png')
      })

      // Observe the uncached miss through IPC: a fixed 1500ms wait races UNFLUSHED_SETTLE_MS and retry cancellation.
      await expect
        .poll(
          () =>
            helixPage.evaluate(
              ({ id, file }) =>
                window.api.nativeChat
                  .readSession('claude', id, 50, file)
                  .then((result) => Boolean(result && 'error' in result && result.notFound)),
              { id: sessionId, file: transcriptPath }
            ),
          { timeout: 10_000, message: 'transcript resolved before the first flush' }
        )
        .toBe(true)
      await expect(helixPage.getByText(ERROR_TITLE)).toHaveCount(0)

      const userText = 'Explain the native chat first-flush race fix for #8401'
      const assistantText =
        'The main process now retries a not-yet-flushed transcript instead of caching a permanent miss.'
      writeFileSync(transcriptPath, claudeTranscriptLines({ sessionId, userText, assistantText }))

      // Scope to transcript content because user text also appears in workspace/tab chrome.
      const transcript = helixPage.locator('[data-native-chat-root="true"]')
      await expect(transcript.getByText(userText)).toBeVisible({ timeout: 30_000 })
      await expect(transcript.getByText(assistantText)).toBeVisible({ timeout: 30_000 })
      await expect(helixPage.getByText(ERROR_TITLE)).toHaveCount(0)
      await helixPage.screenshot({
        path: path.join(screenshotDir, '02-hydrated.png')
      })
    } finally {
      rmSync(scratchDir, { recursive: true, force: true })
    }
  })
})
