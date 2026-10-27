import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HelixCloudSignInProgress,
  HelixProfileAuthStatus
} from '../../../../shared/helix-profiles'
import { createTestStore } from '../../store/slices/store-test-helpers'

type TestStore = ReturnType<typeof createTestStore>

const { storeHolder } = vi.hoisted((): { storeHolder: { current: TestStore | null } } => ({
  storeHolder: { current: null }
}))

vi.mock('../../store', () => ({
  useAppStore: {
    getState: () => storeHolder.current?.getState(),
    setState: (partial: { helixProfileSignInProgress: HelixCloudSignInProgress | null }) =>
      storeHolder.current?.setState(partial)
  }
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }
}))

import { registerHelixProfileAuthIpcBridge } from './helix-profile-auth-ipc-bridge'

const connectedAuthStatus: HelixProfileAuthStatus = {
  activeProfileId: 'local-default',
  configured: true,
  state: 'connected',
  persistence: 'encrypted'
}

const reconnectRequiredAuthStatus: HelixProfileAuthStatus = {
  activeProfileId: 'local-default',
  configured: true,
  state: 'reconnect-required',
  persistence: 'encrypted'
}

describe('helix profile auth IPC bridge', () => {
  let listener: (() => void) | null = null
  const unsubscribe = vi.fn()
  const authStatus = vi.fn()

  beforeEach(() => {
    listener = null
    unsubscribe.mockClear()
    authStatus.mockReset()
    vi.stubGlobal('window', {
      api: {
        helixProfiles: {
          authStatus,
          onAuthStatusChanged: (callback: () => void) => {
            listener = callback
            return unsubscribe
          }
        }
      }
    })
  })

  it('re-fetches auth status on the push, flipping connected to reconnect-required', async () => {
    authStatus.mockResolvedValue(connectedAuthStatus)
    const store = createTestStore()
    storeHolder.current = store
    await store.getState().fetchHelixProfileAuthStatus()
    expect(store.getState().helixProfileAuthStatus).toEqual(connectedAuthStatus)

    const unsubs: (() => void)[] = []
    registerHelixProfileAuthIpcBridge(unsubs)
    authStatus.mockResolvedValue(reconnectRequiredAuthStatus)
    listener?.()
    await vi.waitFor(() =>
      expect(store.getState().helixProfileAuthStatus).toEqual(reconnectRequiredAuthStatus)
    )

    unsubs.forEach((dispose) => dispose())
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('skips registration when the preload bridge does not expose the event', () => {
    vi.stubGlobal('window', { api: { helixProfiles: { authStatus } } })
    const unsubs: (() => void)[] = []

    registerHelixProfileAuthIpcBridge(unsubs)

    expect(unsubs).toHaveLength(0)
  })
})

describe('helix profile sign-in progress IPC bridge', () => {
  let emitProgress: (progress: HelixCloudSignInProgress | null) => void
  const snapshots: ((progress: HelixCloudSignInProgress | null) => void)[] = []
  const WAITING = { link: 'https://login.example/authorize?state=a' }

  beforeEach(() => {
    snapshots.length = 0
    storeHolder.current = createTestStore()
    vi.stubGlobal('window', {
      api: {
        helixProfiles: {
          onSignInProgressChanged: (
            callback: (progress: HelixCloudSignInProgress | null) => void
          ) => {
            emitProgress = callback
            return () => {}
          },
          signInProgress: () =>
            new Promise<HelixCloudSignInProgress | null>((resolve) => {
              snapshots.push(resolve)
            })
        }
      }
    })
  })

  const progress = (): HelixCloudSignInProgress | null =>
    storeHolder.current?.getState().helixProfileSignInProgress ?? null

  it('adopts a sign-in already in flight when the window loads', async () => {
    registerHelixProfileAuthIpcBridge([])
    await vi.waitFor(() => expect(snapshots).toHaveLength(1))
    snapshots[0](WAITING)
    await vi.waitFor(() => expect(progress()).toEqual(WAITING))
  })

  it('lets a newer change win over a late snapshot', async () => {
    registerHelixProfileAuthIpcBridge([])
    await vi.waitFor(() => expect(snapshots).toHaveLength(1))
    emitProgress(null)
    snapshots[0](WAITING)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(progress()).toBeNull()
  })

  it('ignores the snapshot of a registration torn down before it arrived', async () => {
    const first: (() => void)[] = []
    registerHelixProfileAuthIpcBridge(first)
    await vi.waitFor(() => expect(snapshots).toHaveLength(1))
    first.forEach((dispose) => dispose())
    registerHelixProfileAuthIpcBridge([])
    emitProgress(null)

    snapshots[0](WAITING)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(progress()).toBeNull()
  })
})
