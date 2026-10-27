/** Mirrors HELIX_REQUIRED_TEST_INPUTS_ENV in src/main/helixd/helixd-node-slot-fixture.ts. */
export const REQUIRED_TEST_INPUTS_ENV = 'HELIX_REQUIRED_TEST_INPUTS'

// Need the pinned Bun and the last Bun helixd slot beside the built Node slot (design D7).
export const CROSS_RUNTIME_TEST_PATHS = [
  'src/main/helixd/helixd-cross-runtime-daemon-adoption.integration.test.ts',
  'src/main/persistence/profile-state/profile-state-cross-runtime.integration.test.ts'
]

// Need the built desktop server template; CI runs them by path after build-helixd-template.mjs.
export const TEMPLATE_TEST_PATHS = [
  'src/main/helixd/helixd-packaged-structured-chat.integration.test.ts'
]

export function nodeServerTestPaths({
  artifact = false,
  crossRuntime = false,
  template = false
} = {}) {
  return [
    'src/main/persistence/profile-state',
    'src/main/persistence/loading-store/profile-state',
    'src/main/sqlite',
    'src/main/helixd/helixd-entry.test.ts',
    'src/main/helixd/helixd-push-startup.test.ts',
    // The helixd server's identity and stop path, which Windows SSH hosts rely on (W2).
    'src/main/helixd/helixd-instance-lock.test.ts',
    'src/main/helixd/helixd-process-start-time.test.ts',
    'src/main/helixd/helixd-stop-request-listener.test.ts',
    'src/main/helixd/helixd-managed-stop.test.ts',
    'src/main/helixd/helixd-managed-stop-cancellation.test.ts',
    'src/main/helixd/helixd-daemon-teardown-linux.test.ts',
    // The directory, not a prefix: its siblings are POSIX-host unit tests pr.yml already runs.
    'src/main/daemon/pty-subprocess/',
    'src/main/daemon/pty-subprocess-spawn-file-foreground.test.ts',
    'src/main/daemon/pty-subprocess-io-failure-native.test.ts',
    ...(artifact
      ? [
          'tests/e2e/daemon-running-work-probe.unit.test.ts',
          'src/shared/pty-running-work-probe.test.ts',
          'src/main/helixd/helixd-packaged-node-pty.integration.test.ts',
          'src/main/providers/agent-foreground-process-git-bash.win32.test.ts',
          'src/main/helixd/helixd-node-launcher.integration.test.ts',
          'src/main/helixd/helixd-cli-launcher.integration.test.ts',
          'src/main/helixd/helixd-cli-orchestration.integration.test.ts',
          'src/main/helixd/helixd-launcher-isolation.integration.test.ts',
          'src/main/helixd/helixd-stop-request-shutdown.integration.test.ts',
          'src/main/helixd/helixd-windows-conpty-breakaway.integration.test.ts',
          'src/main/helixd/helixd-serve-parity.integration.test.ts',
          'config/scripts/zip-extractor-command.test.mjs'
        ]
      : []),
    ...(crossRuntime ? CROSS_RUNTIME_TEST_PATHS : []),
    ...(template ? TEMPLATE_TEST_PATHS : [])
  ]
}
