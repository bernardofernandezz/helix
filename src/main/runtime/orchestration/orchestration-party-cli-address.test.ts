import { afterEach, describe, expect, it } from 'vitest'
import { injectedSessionAddress } from '../../../shared/agent-session-caller-env'
import { testHelixSessionId } from '../../../shared/helix-session-address-test-fixture'
import {
  mintStructuredWorkerHandle,
  mintStructuredWorkerPaneKey,
  structuredWorkerIdentities,
  structuredWorkerProcessIncarnation
} from '../structured-worker-identity'
import { resolveHelixSessionParty } from './orchestration-party'

// The CLI formats its address before host resolution; both paths must name the same mailbox.
const CHAT = testHelixSessionId('f7a1c0de-1111-4222-8333-444455556666')
const WORKER = testHelixSessionId('a0b1c2d3-0000-4000-8000-00000000abcd')

afterEach(() => {
  structuredWorkerIdentities.clear()
})

describe("the CLI's own address", () => {
  it("is a chat's session address, even beside a pane handle it inherited", () => {
    const hostAddress = resolveHelixSessionParty(CHAT, null).address
    expect(injectedSessionAddress({ HELIX_AGENT_SESSION_ID: CHAT })).toBe(hostAddress)
    expect(
      injectedSessionAddress({
        HELIX_AGENT_SESSION_ID: CHAT,
        HELIX_TERMINAL_HANDLE: 'term_inherited'
      })
    ).toBe(hostAddress)
  })

  it("is a structured worker's minted handle, as the host resolves it", () => {
    const handle = mintStructuredWorkerHandle()
    structuredWorkerIdentities.register({
      handle,
      sessionId: WORKER,
      agent: 'claude',
      paneKey: mintStructuredWorkerPaneKey(WORKER),
      processIncarnation: structuredWorkerProcessIncarnation(WORKER),
      worktreeId: 'wt_1',
      hostScope: { kind: 'local', hostId: 'local' }
    })
    const hostAddress = resolveHelixSessionParty(WORKER, null).address
    expect(hostAddress).toBe(handle)
    expect(
      injectedSessionAddress({ HELIX_AGENT_SESSION_ID: WORKER, HELIX_TERMINAL_HANDLE: handle })
    ).toBe(hostAddress)
  })
})
