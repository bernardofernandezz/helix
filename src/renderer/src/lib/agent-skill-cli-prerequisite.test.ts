import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { CliInstallStatus } from '../../../shared/cli-install-types'
import {
  CLI_PREREQUISITE_REGISTRATION_TOAST,
  CLI_PREREQUISITE_REGISTRATION_TOAST_DESCRIPTION,
  ensureHelixCliAvailableForAgentSkillTerminal,
  isHelixCliAvailableOnPath
} from './agent-skill-cli-prerequisite'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    message: vi.fn(),
    warning: vi.fn()
  }
}))

function cliStatus(overrides: Partial<CliInstallStatus> = {}): CliInstallStatus {
  return {
    platform: 'darwin',
    commandName: 'helix',
    commandPath: '/usr/local/bin/helix',
    pathDirectory: '/usr/local/bin',
    pathConfigured: true,
    launcherPath: '/Applications/Helix.app/Contents/MacOS/helix',
    installMethod: 'symlink',
    supported: true,
    state: 'installed',
    currentTarget: null,
    unsupportedReason: null,
    detail: null,
    ...overrides
  }
}

describe('isHelixCliAvailableOnPath', () => {
  it('requires the installed CLI command to be visible on PATH', () => {
    expect(isHelixCliAvailableOnPath(cliStatus())).toBe(true)
    expect(isHelixCliAvailableOnPath(cliStatus({ pathConfigured: false }))).toBe(false)
    expect(isHelixCliAvailableOnPath(cliStatus({ state: 'not_installed' }))).toBe(false)
  })
})

describe('ensureHelixCliAvailableForAgentSkillTerminal', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('runs the CLI installer when the command exists but is not visible on PATH', async () => {
    const initial = cliStatus({
      pathConfigured: false,
      detail: '/usr/local/bin is not currently visible on PATH.'
    })
    const installed = cliStatus()
    const getInstallStatus = vi.fn().mockResolvedValue(initial)
    const install = vi.fn().mockResolvedValue(installed)
    const onStatusChange = vi.fn()

    vi.stubGlobal('window', {
      api: {
        cli: {
          getInstallStatus,
          install
        }
      }
    })

    await expect(
      ensureHelixCliAvailableForAgentSkillTerminal({
        onStatusChange,
        registrationPromptDelayMs: 0
      })
    ).resolves.toBe(installed)

    expect(install).toHaveBeenCalledTimes(1)
    expect(toast.message).toHaveBeenCalledWith(CLI_PREREQUISITE_REGISTRATION_TOAST, {
      description: CLI_PREREQUISITE_REGISTRATION_TOAST_DESCRIPTION
    })
    expect(onStatusChange).toHaveBeenNthCalledWith(1, initial)
    expect(onStatusChange).toHaveBeenNthCalledWith(2, installed)
  })

  it('does not run the CLI installer when the Windows PATH read is unknown', async () => {
    const initial = cliStatus({
      platform: 'win32',
      pathConfigured: null,
      detail: 'Helix could not read the Windows user PATH registry value.'
    })
    const install = vi.fn()
    vi.stubGlobal('window', {
      api: { cli: { getInstallStatus: vi.fn().mockResolvedValue(initial), install } }
    })

    await expect(
      ensureHelixCliAvailableForAgentSkillTerminal({ registrationPromptDelayMs: 0 })
    ).resolves.toBe(initial)

    expect(install).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringMatching(/could not check/i),
      expect.objectContaining({ description: initial.detail })
    )
  })

  it('lets the registration toast paint before opening the native installer', async () => {
    vi.useFakeTimers()
    const initial = cliStatus({ state: 'stale' })
    const installed = cliStatus()
    const getInstallStatus = vi.fn().mockResolvedValue(initial)
    const install = vi.fn().mockResolvedValue(installed)

    vi.stubGlobal('window', {
      setTimeout,
      api: {
        cli: {
          getInstallStatus,
          install
        }
      }
    })

    const pending = ensureHelixCliAvailableForAgentSkillTerminal({ registrationPromptDelayMs: 700 })
    await Promise.resolve()
    expect(toast.message).toHaveBeenCalledWith(CLI_PREREQUISITE_REGISTRATION_TOAST, {
      description: CLI_PREREQUISITE_REGISTRATION_TOAST_DESCRIPTION
    })
    expect(install).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(699)
    expect(install).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBe(installed)
    expect(install).toHaveBeenCalledTimes(1)
  })
})
