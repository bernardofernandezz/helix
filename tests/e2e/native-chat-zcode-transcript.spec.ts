import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/helix-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActiveTerminalManager } from './helpers/terminal'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'
import {
  enableNativeChatSetting,
  toggleTerminalTabToChatView
} from './helpers/native-chat-transcript-fixture'

test('ZCode native chat reads ordered visible history and follows new messages', async ({
  helixPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(helixPage)
  await waitForActiveWorktree(helixPage)
  await ensureTerminalVisible(helixPage)
  await waitForActiveTerminalManager(helixPage, 30_000)
  const home = await electronApp.evaluate(({ app }) => app.getPath('home'))
  const dbPath = path.join(home, '.zcode', 'cli', 'db', 'db.sqlite')
  mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT, sequence INTEGER);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT, sequence INTEGER);
      INSERT INTO session VALUES ('zcode-proof');
    `)
    const insert = (id: string, role: string, text: string, sequence: number, hidden = false) => {
      db.prepare('INSERT INTO message VALUES (?, ?, 1, 1, ?, ?)').run(
        id,
        'zcode-proof',
        JSON.stringify({
          role,
          semantics: { transcriptVisibility: hidden ? 'hidden' : 'visible' }
        }),
        sequence
      )
      db.prepare('INSERT INTO part VALUES (?, ?, ?, 1, 1, ?, 0)').run(
        id,
        id,
        'zcode-proof',
        JSON.stringify({ type: 'text', text })
      )
    }
    insert('answer', 'assistant', 'The stored conversation now opens in native chat.', 2)
    insert('question', 'user', 'Show my saved ZCode conversation.', 0)
    insert('hidden', 'user', 'HIDDEN BOOKKEEPING MUST NOT RENDER', 1, true)
    const descriptor = await waitForActivePaneHookDescriptor(helixPage)
    const [tabId] = descriptor.paneKey.split(':')
    await enableNativeChatSetting(helixPage)
    const endpoint = await readHookEndpoint(electronApp)
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/zcode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Helix-Agent-Hook-Token': endpoint.token
      },
      body: JSON.stringify({
        ...descriptor,
        tabId,
        env: endpoint.env,
        version: endpoint.version,
        payload: {
          hook_event_name: 'SessionStart',
          source: 'resume',
          session_id: 'zcode-proof'
        }
      })
    })
    expect(response.status).toBe(204)
    await expect
      .poll(() =>
        helixPage.evaluate(
          (paneKey) => window.__store?.getState().agentStatusByPaneKey[paneKey]?.agentType,
          descriptor.paneKey
        )
      )
      .toBe('zcode')
    await helixPage.screenshot({ path: testInfo.outputPath('01-terminal-before-chat.png') })
    await toggleTerminalTabToChatView(helixPage, { tabId, worktreeId: descriptor.worktreeId })
    const chat = helixPage.locator('[data-native-chat-root="true"]')
    await expect(chat).toBeVisible({ timeout: 15_000 })
    await expect(chat.getByText('Show my saved ZCode conversation.')).toBeVisible({
      timeout: 30_000
    })
    await expect(chat.getByText('The stored conversation now opens in native chat.')).toBeVisible()
    await expect(chat.getByText('HIDDEN BOOKKEEPING MUST NOT RENDER')).toHaveCount(0)
    const transcriptText = await chat.innerText()
    expect(transcriptText.indexOf('Show my saved ZCode conversation.')).toBeLessThan(
      transcriptText.indexOf('The stored conversation now opens in native chat.')
    )
    await helixPage.screenshot({ path: testInfo.outputPath('02-ordered-history.png') })
    insert('followup', 'assistant', 'Live updates also reach this conversation.', 3)
    await expect(chat.getByText('Live updates also reach this conversation.')).toBeVisible({
      timeout: 15_000
    })
    await helixPage.screenshot({ path: testInfo.outputPath('03-live-update.png') })
  } finally {
    db.close()
  }
})
