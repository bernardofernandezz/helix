import { stripAnsiEscapeSequences } from '../../src/shared/ansi-escape-sequences'
import { test, expect } from './helpers/helix-app'
import { ensureTerminalVisible } from './helpers/store'
import {
  focusActiveTerminalInput,
  getTerminalContent,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'

const CSI_REPLY_RE = /997;[12]n/

function shellBasename(processName: string): string {
  return processName
    .replaceAll('\\', '/')
    .split('/')
    .pop()!
    .toLowerCase()
    .replace(/\.exe$/, '')
}

test('seeded project terminal runs a typed shell command @golden', async ({ helixPage }) => {
  await ensureTerminalVisible(helixPage, 30_000)
  await waitForActiveTerminalManager(helixPage, 30_000)
  const ptyId = await waitForActivePanePtyId(helixPage, 30_000)
  expect(await getTerminalContent(helixPage)).not.toMatch(CSI_REPLY_RE)

  const marker = `helix-e2e-alive-${Date.now()}`
  await focusActiveTerminalInput(helixPage)
  await helixPage.keyboard.type(`echo ${marker}`)
  await helixPage.keyboard.press('Enter')
  await expect
    .poll(async () => (await getTerminalContent(helixPage)).split(marker).length - 1, {
      message: 'marker should appear in both the echoed command and command output'
    })
    .toBeGreaterThanOrEqual(2)

  if (process.platform === 'win32') {
    let foregroundProcess = ''
    await expect
      .poll(async () => {
        foregroundProcess =
          (await helixPage.evaluate((id) => window.api.pty.inspectProcess(id), ptyId))
            .foregroundProcess ?? ''
        return foregroundProcess
      })
      .not.toBe('')
    const shell = shellBasename(foregroundProcess)
    if (shell === 'cmd') {
      const pwshAvailable = await helixPage.evaluate(() => window.api.pwsh.isAvailable())
      expect(pwshAvailable, 'cmd.exe must not replace an available PowerShell default').toBe(false)
    }
    const begin = 'HELIX_E2E_PATH_BEGIN'
    const end = 'HELIX_E2E_PATH_END'
    const pathCommand =
      shell === 'pwsh' || shell === 'powershell'
        ? `Write-Output ${begin}; Write-Output $env:LOCALAPPDATA; Write-Output ${end}`
        : shell === 'cmd'
          ? `echo ${begin} & echo %LOCALAPPDATA% & echo ${end}`
          : `printf '${begin}\\n%s\\n${end}\\n' "$LOCALAPPDATA"`
    await focusActiveTerminalInput(helixPage)
    await helixPage.keyboard.type(pathCommand)
    await helixPage.keyboard.press('Enter')
    let expandedPath = ''
    await expect
      .poll(async () => {
        // Require an exact bracketed marker line; wrapped/clipped input echo cannot prove execution.
        const lines = stripAnsiEscapeSequences(await getTerminalContent(helixPage, 8_000))
          .split(/\r?\n/)
          .map((line) => line.trim())
        const beginLine = lines.lastIndexOf(begin)
        const endLine = beginLine === -1 ? -1 : lines.indexOf(end, beginLine + 1)
        expandedPath =
          endLine === -1 ? '' : (lines.slice(beginLine + 1, endLine).find(Boolean) ?? '')
        return expandedPath
      })
      .not.toBe('')

    expect(expandedPath).not.toBe('')
    expect(expandedPath).not.toBe('%LOCALAPPDATA%')
    expect(expandedPath).not.toBe('$env:LOCALAPPDATA')
    expect(expandedPath).toMatch(/(?:[A-Za-z]:\\|\\\\)/)
  }

  const finalBuffer = await getTerminalContent(helixPage, 8_000)
  expect(finalBuffer).not.toMatch(CSI_REPLY_RE)
})
