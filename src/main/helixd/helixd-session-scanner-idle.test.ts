import { describe, expect, it } from 'vitest'
import {
  helixdSessionScannerIdleTimeoutMs,
  WSL_HOST_SESSION_SCANNER_IDLE_TIMEOUT_MS
} from './helixd-session-scanner-idle'

describe('helixdSessionScannerIdleTimeoutMs', () => {
  it('shortens the scanner idle timeout to three minutes on a WSL host', () => {
    expect(helixdSessionScannerIdleTimeoutMs(() => true)).toBe(
      WSL_HOST_SESSION_SCANNER_IDLE_TIMEOUT_MS
    )
    expect(WSL_HOST_SESSION_SCANNER_IDLE_TIMEOUT_MS).toBe(180_000)
  })

  it('leaves an SSH host on the scanner’s own default', () => {
    expect(helixdSessionScannerIdleTimeoutMs(() => false)).toBeNull()
  })
})
