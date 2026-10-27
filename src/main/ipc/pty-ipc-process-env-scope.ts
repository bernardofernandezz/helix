// Split suites rewrite platform and agent-home environment; capture and restore the host values.
export function createPtyIpcProcessEnvScope() {
  const savedOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR
  const savedHelixOpenCodeConfigDir = process.env.HELIX_OPENCODE_CONFIG_DIR
  const savedHelixOpenCodeSourceConfigDir = process.env.HELIX_OPENCODE_SOURCE_CONFIG_DIR
  const savedPiAgentDir = process.env.PI_CODING_AGENT_DIR
  const savedHelixPiAgentDir = process.env.HELIX_PI_CODING_AGENT_DIR
  const savedHelixPiSourceAgentDir = process.env.HELIX_PI_SOURCE_AGENT_DIR
  const savedHelixCodexHome = process.env.HELIX_CODEX_HOME
  const savedHelixOmpAgentDir = process.env.HELIX_OMP_CODING_AGENT_DIR
  const savedHelixOmpSourceAgentDir = process.env.HELIX_OMP_SOURCE_AGENT_DIR
  const savedHelixOmpStatusExtension = process.env.HELIX_OMP_STATUS_EXTENSION
  const savedPrimeAgentDir = process.env.PRIME_AGENT_CODING_AGENT_DIR
  const savedHelixPrimeAgentSourceDir = process.env.HELIX_PRIME_AGENT_SOURCE_AGENT_DIR
  const savedHelixPrimeAgentStatusExtension = process.env.HELIX_PRIME_AGENT_STATUS_EXTENSION
  const savedHelixClaudeAgentStatusSettings = process.env.HELIX_CLAUDE_AGENT_STATUS_SETTINGS
  const savedProcessPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const savedDisableMacosLoginShell = process.env.HELIX_DISABLE_MACOS_LOGIN_SHELL
  const savedHelixUserDataPath = process.env.HELIX_USER_DATA_PATH

  function applyTestEnvDefaults() {
    // POSIX is the default fixture; Windows cases explicitly opt in.
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin'
    })
    // Disable the TCC argv wrapper except in its dedicated tests.
    process.env.HELIX_DISABLE_MACOS_LOGIN_SHELL = '1'
    delete process.env.OPENCODE_CONFIG_DIR
    delete process.env.HELIX_OPENCODE_SOURCE_CONFIG_DIR
    delete process.env.HELIX_OPENCODE_CONFIG_DIR
    delete process.env.HELIX_AGENT_HOOK_ENDPOINT
    delete process.env.HELIX_CLAUDE_AGENT_STATUS_SETTINGS
    delete process.env.PI_CODING_AGENT_DIR
    delete process.env.HELIX_PI_SOURCE_AGENT_DIR
    delete process.env.HELIX_PI_CODING_AGENT_DIR
    delete process.env.HELIX_CODEX_HOME
    delete process.env.HELIX_OMP_SOURCE_AGENT_DIR
    delete process.env.HELIX_OMP_CODING_AGENT_DIR
    delete process.env.HELIX_OMP_STATUS_EXTENSION
    delete process.env.PRIME_AGENT_CODING_AGENT_DIR
    delete process.env.HELIX_PRIME_AGENT_SOURCE_AGENT_DIR
    delete process.env.HELIX_PRIME_AGENT_STATUS_EXTENSION
  }

  function restoreProcessEnv() {
    if (savedProcessPlatform) {
      Object.defineProperty(process, 'platform', savedProcessPlatform)
    }
    if (savedDisableMacosLoginShell !== undefined) {
      process.env.HELIX_DISABLE_MACOS_LOGIN_SHELL = savedDisableMacosLoginShell
    } else {
      delete process.env.HELIX_DISABLE_MACOS_LOGIN_SHELL
    }
    if (savedHelixUserDataPath !== undefined) {
      process.env.HELIX_USER_DATA_PATH = savedHelixUserDataPath
    } else {
      delete process.env.HELIX_USER_DATA_PATH
    }
    if (savedOpenCodeConfigDir !== undefined) {
      process.env.OPENCODE_CONFIG_DIR = savedOpenCodeConfigDir
    } else {
      delete process.env.OPENCODE_CONFIG_DIR
    }
    if (savedHelixOpenCodeConfigDir !== undefined) {
      process.env.HELIX_OPENCODE_CONFIG_DIR = savedHelixOpenCodeConfigDir
    } else {
      delete process.env.HELIX_OPENCODE_CONFIG_DIR
    }
    if (savedHelixOpenCodeSourceConfigDir !== undefined) {
      process.env.HELIX_OPENCODE_SOURCE_CONFIG_DIR = savedHelixOpenCodeSourceConfigDir
    } else {
      delete process.env.HELIX_OPENCODE_SOURCE_CONFIG_DIR
    }
    if (savedPiAgentDir !== undefined) {
      process.env.PI_CODING_AGENT_DIR = savedPiAgentDir
    } else {
      delete process.env.PI_CODING_AGENT_DIR
    }
    if (savedHelixPiAgentDir !== undefined) {
      process.env.HELIX_PI_CODING_AGENT_DIR = savedHelixPiAgentDir
    } else {
      delete process.env.HELIX_PI_CODING_AGENT_DIR
    }
    if (savedHelixPiSourceAgentDir === undefined) {
      delete process.env.HELIX_PI_SOURCE_AGENT_DIR
    } else {
      process.env.HELIX_PI_SOURCE_AGENT_DIR = savedHelixPiSourceAgentDir
    }
    if (savedHelixCodexHome === undefined) {
      delete process.env.HELIX_CODEX_HOME
    } else {
      process.env.HELIX_CODEX_HOME = savedHelixCodexHome
    }
    if (savedHelixOmpAgentDir !== undefined) {
      process.env.HELIX_OMP_CODING_AGENT_DIR = savedHelixOmpAgentDir
    } else {
      delete process.env.HELIX_OMP_CODING_AGENT_DIR
    }
    if (savedHelixOmpSourceAgentDir !== undefined) {
      process.env.HELIX_OMP_SOURCE_AGENT_DIR = savedHelixOmpSourceAgentDir
    } else {
      delete process.env.HELIX_OMP_SOURCE_AGENT_DIR
    }
    if (savedHelixOmpStatusExtension !== undefined) {
      process.env.HELIX_OMP_STATUS_EXTENSION = savedHelixOmpStatusExtension
    } else {
      delete process.env.HELIX_OMP_STATUS_EXTENSION
    }
    if (savedPrimeAgentDir !== undefined) {
      process.env.PRIME_AGENT_CODING_AGENT_DIR = savedPrimeAgentDir
    } else {
      delete process.env.PRIME_AGENT_CODING_AGENT_DIR
    }
    if (savedHelixPrimeAgentSourceDir !== undefined) {
      process.env.HELIX_PRIME_AGENT_SOURCE_AGENT_DIR = savedHelixPrimeAgentSourceDir
    } else {
      delete process.env.HELIX_PRIME_AGENT_SOURCE_AGENT_DIR
    }
    if (savedHelixPrimeAgentStatusExtension !== undefined) {
      process.env.HELIX_PRIME_AGENT_STATUS_EXTENSION = savedHelixPrimeAgentStatusExtension
    } else {
      delete process.env.HELIX_PRIME_AGENT_STATUS_EXTENSION
    }
    if (savedHelixClaudeAgentStatusSettings === undefined) {
      delete process.env.HELIX_CLAUDE_AGENT_STATUS_SETTINGS
    } else {
      process.env.HELIX_CLAUDE_AGENT_STATUS_SETTINGS = savedHelixClaudeAgentStatusSettings
    }
  }

  return { applyTestEnvDefaults, restoreProcessEnv }
}
