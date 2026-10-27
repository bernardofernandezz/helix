import { describe, expect, it } from 'vitest'
import { isAbsolute } from 'node:path'
import { getShellReadyWrapperRoot } from '../providers/local-pty-shell-ready-wrapper-root'
import {
  SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV,
  SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV
} from '../../shared/setup-agent-sequencing'
import { addHelixWslInteropEnv, stampWslOrchestrationCompatibilityHost } from './wsl-helix-env'
import { CODEX_REMOTE_VIEWER_SSH_CONNECTION } from '../ipc/pty/host-env/codex-terminal-clipboard'

describe('addHelixWslInteropEnv', () => {
  it.each(['1', '0'])(
    'forwards Claude image override %s to WSL without path translation',
    (value) => {
      const env: Record<string, string> = { CLAUDE_CODE_FORCE_TERMINAL_IMAGES: value }

      addHelixWslInteropEnv(env)
      addHelixWslInteropEnv(env)

      expect(env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES).toBe(value)
      expect(
        env.WSLENV.split(':').filter((entry) =>
          entry.startsWith('CLAUDE_CODE_FORCE_TERMINAL_IMAGES')
        )
      ).toEqual(['CLAUDE_CODE_FORCE_TERMINAL_IMAGES/u'])
    }
  )

  it('marks the Helix terminal handle for Windows to WSL env import', () => {
    const env: Record<string, string> = { HELIX_TERMINAL_HANDLE: 'term_wsl' }

    addHelixWslInteropEnv(env)

    expect(env.WSLENV).toBe('HELIX_TERMINAL_HANDLE/u:HELIX_SHELL_READY_ROOT/p')
  })

  // Guests cannot derive the wrapper content hash from userData; publish the resolved root to avoid unwrapped launches.
  it('publishes the resolved wrapper root path-translated for the guest', () => {
    const env: Record<string, string> = {}

    addHelixWslInteropEnv(env)

    expect(env.HELIX_SHELL_READY_ROOT).toBe(getShellReadyWrapperRoot())
    expect(isAbsolute(env.HELIX_SHELL_READY_ROOT as string)).toBe(true)
    // Translate the host wrapper path for guest access.
    expect(env.WSLENV?.split(':')).toContain('HELIX_SHELL_READY_ROOT/p')
  })

  it('imports setup-gated startup env into WSL without path translation', () => {
    const env: Record<string, string> = {
      [SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV]: 'codex',
      [SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV]: 'while :; do sleep 1; done'
    }

    addHelixWslInteropEnv(env)

    expect(env.WSLENV?.split(':')).toEqual([
      'HELIX_SHELL_READY_ROOT/p',
      `${SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV}/u`,
      `${SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV}/u`
    ])
  })

  it('preserves existing WSLENV entries and does not duplicate the handle entry', () => {
    const env: Record<string, string> = {
      WSLENV: 'FOO/u:HELIX_TERMINAL_HANDLE/u:BAR/p'
    }

    addHelixWslInteropEnv(env)

    expect(env.WSLENV).toBe('FOO/u:HELIX_TERMINAL_HANDLE/u:BAR/p:HELIX_SHELL_READY_ROOT/p')
  })

  it('marks OMP status and hook env for Windows to WSL import', () => {
    const env: Record<string, string> = {
      HELIX_TERMINAL_HANDLE: 'term_wsl',
      HELIX_USER_DATA_PATH: 'C:\\Users\\ana\\AppData\\Roaming\\Helix',
      HELIX_CLI_COMMAND: 'helix-ide',
      HELIX_WSL_CLI_DIR: 'C:\\Users\\ana\\AppData\\Roaming\\Helix\\wsl-managed-cli\\hash',
      HELIX_CODEX_LAUNCH_PREFLIGHT: 'C:\\Program Files\\Helix\\resources\\bin\\helix.exe',
      HELIX_CODEX_ISOLATE: '0',
      HELIX_OMP_FRESH_CONFIG: 'C:\\Helix\\fresh-session.yml',
      HELIX_OMP_STATUS_EXTENSION: 'C:\\Users\\ana\\.omp\\agent\\extensions\\helix-agent-status.ts',
      HELIX_PRIME_AGENT_STATUS_EXTENSION: 'C:\\stale\\helix-agent-status.ts',
      HELIX_PANE_KEY: 'tab-1:leaf-1',
      HELIX_AGENT_PANE: 'tab-1:leaf-1',
      HELIX_TAB_ID: 'tab-1',
      HELIX_WORKTREE_ID: 'repo::\\\\wsl.localhost\\Ubuntu\\home\\ana\\repo',
      HELIX_AGENT_LAUNCH_TOKEN: 'launch-secret',
      HELIX_AGENT_LAUNCH: 'launch-secret',
      HELIX_OPENCODE_AGENT: 'opencode2',
      HELIX_AGENT_HOOK_PORT: '4567',
      HELIX_AGENT_HOOK_TOKEN: 'token',
      HELIX_AGENT_HOOK_ENV: 'dev',
      HELIX_AGENT_HOOK_VERSION: '1',
      HELIX_AGENT_HOOK_TRANSPORT: 'raw-json-v1',
      HELIX_WSL_HOOK_INSTANCE: 'testinstance',
      HELIX_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'wsl',
      HELIX_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'local',
      HELIX_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'Ubuntu',
      HELIX_RUNTIME_SOURCE_ID: '11111111-1111-4111-8111-111111111111',
      HELIX_RUNTIME_SOURCE_INCARNATION: 'runtime-a',
      HELIX_RUNTIME_SOURCE_PROFILE_PATH: 'C:\\Users\\a\\AppData\\Roaming\\helix'
    }

    addHelixWslInteropEnv(env)

    expect(env.WSLENV).toContain('HELIX_TERMINAL_HANDLE/u')
    expect(env.WSLENV).toContain('HELIX_USER_DATA_PATH/p')
    expect(env.WSLENV).toContain('HELIX_CLI_COMMAND/u')
    expect(env.WSLENV).toContain('HELIX_WSL_CLI_DIR/p')
    expect(env.WSLENV).toContain('HELIX_CODEX_LAUNCH_PREFLIGHT/p')
    expect(env.WSLENV).toContain('HELIX_CODEX_ISOLATE/u')
    expect(env.WSLENV).toContain('HELIX_OMP_STATUS_EXTENSION/p')
    expect(env.WSLENV).toContain('HELIX_OMP_FRESH_CONFIG/p')
    expect(env.WSLENV).not.toContain('HELIX_PRIME_AGENT_STATUS_EXTENSION')
    expect(env.WSLENV).toContain('HELIX_PANE_KEY/u')
    expect(env.WSLENV).toContain('HELIX_AGENT_PANE/u')
    expect(env.WSLENV).toContain('HELIX_TAB_ID/u')
    expect(env.WSLENV).toContain('HELIX_WORKTREE_ID/u')
    expect(env.WSLENV).toContain('HELIX_AGENT_LAUNCH_TOKEN/u')
    expect(env.WSLENV).toContain('HELIX_AGENT_LAUNCH/u')
    expect(env.WSLENV).toContain('HELIX_OPENCODE_AGENT/u')
    expect(env.WSLENV).toContain('HELIX_AGENT_HOOK_PORT/u')
    expect(env.WSLENV).toContain('HELIX_AGENT_HOOK_TOKEN/u')
    expect(env.WSLENV).toContain('HELIX_AGENT_HOOK_ENV/u')
    expect(env.WSLENV).toContain('HELIX_AGENT_HOOK_VERSION/u')
    expect(env.WSLENV).toContain('HELIX_AGENT_HOOK_TRANSPORT/u')
    expect(env.WSLENV).toContain('HELIX_WSL_HOOK_INSTANCE/u')
    expect(env.WSLENV).toContain('HELIX_ORCHESTRATION_COMPATIBILITY_HOST_KIND/u')
    expect(env.WSLENV).toContain('HELIX_ORCHESTRATION_COMPATIBILITY_HOST_ID/u')
    expect(env.WSLENV).toContain('HELIX_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION/u')
    expect(env.WSLENV).toContain('HELIX_RUNTIME_SOURCE_ID/u')
    expect(env.WSLENV).toContain('HELIX_RUNTIME_SOURCE_INCARNATION/u')
    expect(env.WSLENV).toContain('HELIX_RUNTIME_SOURCE_PROFILE_PATH/u')
  })

  it('overwrites caller host evidence with native runtime WSL authority', () => {
    const env = {
      HELIX_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'ssh',
      HELIX_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'caller-host',
      HELIX_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'caller-incarnation',
      HELIX_ORCHESTRATION_COMPATIBILITY_ATTACHMENT: 'caller-attachment'
    }

    stampWslOrchestrationCompatibilityHost(env, 'local', 'Ubuntu')

    expect(env).toEqual({
      HELIX_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'wsl',
      HELIX_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'local',
      HELIX_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'Ubuntu'
    })
  })

  it('clears inherited host evidence outside a runtime-owned WSL scope', () => {
    const env = {
      HELIX_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'ssh',
      HELIX_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'caller-host',
      HELIX_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'caller-incarnation',
      HELIX_ORCHESTRATION_COMPATIBILITY_ATTACHMENT: 'caller-attachment'
    }

    stampWslOrchestrationCompatibilityHost(env, 'local', null)

    expect(env).toEqual({})
  })

  it('path-translates a Windows hook endpoint but passes a guest-side one untouched', () => {
    const windowsEnv: Record<string, string> = {
      HELIX_AGENT_HOOK_ENDPOINT:
        'C:\\Users\\ana\\AppData\\Roaming\\Helix\\agent-hooks\\endpoint.cmd'
    }
    addHelixWslInteropEnv(windowsEnv)
    expect(windowsEnv.WSLENV).toContain('HELIX_AGENT_HOOK_ENDPOINT/p')

    const guestEnv: Record<string, string> = {
      HELIX_AGENT_HOOK_ENDPOINT: '/home/ana/.helix-wsl/agent-hooks/port-4567/endpoint.env'
    }
    addHelixWslInteropEnv(guestEnv)
    expect(guestEnv.WSLENV).toContain('HELIX_AGENT_HOOK_ENDPOINT/u')
    expect(guestEnv.WSLENV).not.toContain('HELIX_AGENT_HOOK_ENDPOINT/p')
  })

  it('tags pre-translated Linux setup paths /u so WSLENV does not translate them again', () => {
    const env: Record<string, string> = {
      HELIX_ROOT_PATH: '/home/ana/repo',
      HELIX_WORKTREE_PATH: '/home/ana/repo-worktrees/fix-1',
      HELIX_WORKSPACE_NAME: 'fix-1',
      CONDUCTOR_ROOT_PATH: '/home/ana/repo',
      GHOSTX_ROOT_PATH: '/home/ana/repo'
    }

    addHelixWslInteropEnv(env)

    // Already-Linux hook paths must cross untranslated to avoid a second conversion.
    expect(env.WSLENV).toContain('HELIX_ROOT_PATH/u')
    expect(env.WSLENV).toContain('HELIX_WORKTREE_PATH/u')
    expect(env.WSLENV).toContain('CONDUCTOR_ROOT_PATH/u')
    expect(env.WSLENV).toContain('GHOSTX_ROOT_PATH/u')
    expect(env.WSLENV).not.toContain('HELIX_ROOT_PATH/p')
    expect(env.WSLENV).not.toContain('HELIX_WORKTREE_PATH/p')
    expect(env.HELIX_ROOT_PATH).toBe('/home/ana/repo')
    expect(env.HELIX_WORKTREE_PATH).toBe('/home/ana/repo-worktrees/fix-1')
  })

  it('tags untranslated Windows setup paths /p so WSLENV translates them (wsl.exe shell over a Windows worktree)', () => {
    const env: Record<string, string> = {
      HELIX_ROOT_PATH: 'C:\\Users\\ana\\repo',
      HELIX_WORKTREE_PATH: 'C:\\Users\\ana\\repo-worktrees\\fix-1',
      CONDUCTOR_ROOT_PATH: 'C:\\Users\\ana\\repo',
      GHOSTX_ROOT_PATH: 'C:\\Users\\ana\\repo'
    }

    addHelixWslInteropEnv(env)

    expect(env.WSLENV).toContain('HELIX_ROOT_PATH/p')
    expect(env.WSLENV).toContain('HELIX_WORKTREE_PATH/p')
    expect(env.WSLENV).toContain('CONDUCTOR_ROOT_PATH/p')
    expect(env.WSLENV).toContain('GHOSTX_ROOT_PATH/p')
    expect(env.WSLENV).not.toContain('HELIX_ROOT_PATH/u')
    expect(env.WSLENV).not.toContain('HELIX_WORKTREE_PATH/u')
  })

  it('always tags HELIX_WORKSPACE_NAME /u because it is a name, not a path', () => {
    const env: Record<string, string> = { HELIX_WORKSPACE_NAME: 'fix-1' }

    addHelixWslInteropEnv(env)

    expect(env.WSLENV).toBe('HELIX_SHELL_READY_ROOT/p:HELIX_WORKSPACE_NAME/u')
  })

  it.each(['repo::\\\\wsl.localhost\\Ubuntu\\home\\ana\\repo', 'folder:f1'])(
    'crosses the workspace id %s into the guest untranslated (/u), as the window and main stamp it',
    (workspaceId) => {
      const env: Record<string, string> = { HELIX_WORKSPACE_ID: workspaceId }

      addHelixWslInteropEnv(env)

      expect(env.HELIX_WORKSPACE_ID).toBe(workspaceId)
      expect(env.WSLENV?.split(':')).toContain('HELIX_WORKSPACE_ID/u')
    }
  )

  // wsl.exe drops SSH_CONNECTION, so WSL Codex copied only to the Windows clipboard.
  it('crosses the Codex remote-viewer clipboard marker into the guest untranslated (/u)', () => {
    const env: Record<string, string> = { SSH_CONNECTION: CODEX_REMOTE_VIEWER_SSH_CONNECTION }
    addHelixWslInteropEnv(env)
    expect(env.WSLENV?.split(':')).toContain('SSH_CONNECTION/u')
  })

  it("leaves the Windows host's own SSH session out of the guest", () => {
    const env: Record<string, string> = { SSH_CONNECTION: '10.0.0.1 5000 10.0.0.2 22' }
    addHelixWslInteropEnv(env)
    expect(env.WSLENV?.split(':')).not.toContain('SSH_CONNECTION/u')
  })

  it('crosses the inline-image protocol hint into the guest untranslated (/u)', () => {
    const env: Record<string, string> = { HELIX_IMAGE_PROTOCOL: 'kitty' }
    addHelixWslInteropEnv(env)
    expect(env.WSLENV).toContain('HELIX_IMAGE_PROTOCOL/u')
  })

  it('marks the WSL hook relay version for import on relay spawn envs', () => {
    const env: Record<string, string> = {
      HELIX_WSL_HOOK_RELAY_VERSION: '0.1.0+abc'
    }
    addHelixWslInteropEnv(env)
    expect(env.WSLENV).toBe('HELIX_SHELL_READY_ROOT/p:HELIX_WSL_HOOK_RELAY_VERSION/u')
  })

  it('crosses a guest-side OpenCode config overlay untranslated (/u)', () => {
    const env: Record<string, string> = {
      OPENCODE_CONFIG_DIR: '/home/ana/.helix-relay/opencode-overlays/abc',
      HELIX_OPENCODE_CONFIG_DIR: '/home/ana/.helix-relay/opencode-overlays/abc'
    }
    addHelixWslInteropEnv(env)
    expect(env.WSLENV).toContain('OPENCODE_CONFIG_DIR/u')
    expect(env.WSLENV).toContain('HELIX_OPENCODE_CONFIG_DIR/u')
    expect(env.WSLENV).not.toContain('OPENCODE_CONFIG_DIR/p')
  })

  it('never crosses a Windows OpenCode config dir into the guest', () => {
    // Windows overlays can leak through inherited relay/daemon env; never translate them into guest OpenCode config roots.
    const env: Record<string, string> = {
      OPENCODE_CONFIG_DIR: 'C:\\Users\\ana\\AppData\\Roaming\\Helix\\opencode-overlays\\abc',
      HELIX_OPENCODE_CONFIG_DIR: 'C:\\Users\\ana\\AppData\\Roaming\\Helix\\opencode-overlays\\abc'
    }
    addHelixWslInteropEnv(env)
    expect(env.WSLENV).not.toContain('OPENCODE_CONFIG_DIR')
    expect(env.WSLENV).not.toContain('HELIX_OPENCODE_CONFIG_DIR')
  })

  it('does not register the OpenCode config vars when they are absent', () => {
    const env: Record<string, string> = { HELIX_TERMINAL_HANDLE: 'term_wsl' }
    addHelixWslInteropEnv(env)
    expect(env.WSLENV).not.toContain('OPENCODE_CONFIG_DIR')
    expect(env.WSLENV).not.toContain('HELIX_OPENCODE_CONFIG_DIR')
  })
})
