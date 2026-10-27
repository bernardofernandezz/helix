import { beforeEach, describe, expect, it, vi } from 'vitest'

const callRuntimeRpc = vi.hoisted(() => vi.fn())
vi.mock('./runtime-rpc-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callRuntimeRpc
}))

import { RuntimeRpcCallError } from './runtime-rpc-result'
import { resolveStructuredSessionHelixSessionId } from './structured-session-helix-session-id'

const LIVE = '7e3b9d15-2c4a-4f86-a0b1-5c9e2d7f3b64'
const ROOT = '4a1f6c2e-8b3d-4e7a-9c15-0d2b6e8f1a37'
const LOCAL = { kind: 'local' } as const

function failure(code: string, message: string): RuntimeRpcCallError {
  return new RuntimeRpcCallError({
    id: 'rpc_1',
    ok: false,
    error: { code, message },
    _meta: { runtimeId: 'runtime_1' }
  })
}

describe('the Helix session ID a chat copies', () => {
  beforeEach(() => {
    callRuntimeRpc.mockReset()
  })

  it("is the host's Helix session ID for the conversation, not the live session's", async () => {
    callRuntimeRpc.mockResolvedValue({ helixSessionId: `helix_session_id:${ROOT}` })

    await expect(resolveStructuredSessionHelixSessionId(LOCAL, LIVE)).resolves.toBe(
      `helix_session_id:${ROOT}`
    )
    expect(callRuntimeRpc).toHaveBeenCalledWith(LOCAL, 'orchestration.sessionAddress', {
      sessionId: LIVE
    })
  })

  it("is the live session's on a host that predates the method", async () => {
    callRuntimeRpc.mockRejectedValue(failure('method_not_found', 'Unknown method'))

    await expect(resolveStructuredSessionHelixSessionId(LOCAL, LIVE)).resolves.toBe(
      `helix_session_id:${LIVE}`
    )
  })

  it('surfaces any other failure instead of guessing', async () => {
    callRuntimeRpc.mockRejectedValue(failure('runtime_unavailable', 'down'))

    await expect(resolveStructuredSessionHelixSessionId(LOCAL, LIVE)).rejects.toThrow('down')
  })

  it('asks nothing for an id that is not an Helix session id', async () => {
    await expect(resolveStructuredSessionHelixSessionId(LOCAL, 'not an id')).resolves.toBe(null)
    expect(callRuntimeRpc).not.toHaveBeenCalled()
  })
})
