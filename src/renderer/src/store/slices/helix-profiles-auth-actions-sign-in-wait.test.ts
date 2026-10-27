import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConnectCurrentHelixProfileResult,
  HelixProfileAuthStatus
} from '../../../../shared/helix-profiles'
import { createTestStore } from './store-test-helpers'

const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  }
}))

const localAuth: HelixProfileAuthStatus = {
  activeProfileId: 'local-default',
  configured: true,
  state: 'local',
  persistence: 'none'
}

const helixProfilesApi = {
  connectCurrent: vi.fn()
}

function deferredConnect(): (result: ConnectCurrentHelixProfileResult) => void {
  let finish!: (result: ConnectCurrentHelixProfileResult) => void
  helixProfilesApi.connectCurrent.mockReturnValueOnce(
    new Promise<ConnectCurrentHelixProfileResult>((resolve) => {
      finish = resolve
    })
  )
  return (result) => finish(result)
}

describe('helix profile sign-in timeout', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('window', {
      api: { helixProfiles: helixProfilesApi }
    })
  })

  it('reports a timeout only for the newest wait', async () => {
    const finishFirst = deferredConnect()
    const finishSecond = deferredConnect()
    const store = createTestStore()

    const first = store.getState().connectCurrentHelixProfile()
    const second = store.getState().connectCurrentHelixProfile()
    finishFirst({ status: 'cancelled', auth: localAuth })
    await first
    expect(toastErrorMock).not.toHaveBeenCalled()

    finishSecond({ status: 'timed-out', auth: localAuth })
    await second
    expect(toastErrorMock).toHaveBeenCalledOnce()
    expect(toastErrorMock).toHaveBeenCalledWith('Sign-in timed out')
  })

  it('stays silent when the user cancels in the browser', async () => {
    helixProfilesApi.connectCurrent.mockResolvedValueOnce({ status: 'cancelled', auth: localAuth })
    const store = createTestStore()

    await store.getState().connectCurrentHelixProfile()

    expect(toastErrorMock).not.toHaveBeenCalled()
  })
})
