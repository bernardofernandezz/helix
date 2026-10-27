import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createProfileStateStoreForStartupMock,
  emitMock,
  ensureActiveHelixProfileMock,
  initHelixProfilePathsMock,
  initSshHostKeyStoreFileMock
} = vi.hoisted(() => ({
  createProfileStateStoreForStartupMock: vi.fn(),
  emitMock: vi.fn(),
  ensureActiveHelixProfileMock: vi.fn(),
  initHelixProfilePathsMock: vi.fn(),
  initSshHostKeyStoreFileMock: vi.fn()
}))

vi.mock('../persistence/profile-state/profile-state-startup-authority', () => ({
  createProfileStateStoreForStartup: createProfileStateStoreForStartupMock
}))
vi.mock('../helix-profiles/profile-index-store', () => ({
  ensureActiveHelixProfile: ensureActiveHelixProfileMock,
  initHelixProfilePaths: initHelixProfilePathsMock
}))
vi.mock('../ssh/ssh-host-key-store', () => ({
  initSshHostKeyStoreFile: initSshHostKeyStoreFileMock
}))
vi.mock('./helixd-profile-state-telemetry', () => ({
  emitHelixdProfileStateAuthoritySelected: emitMock
}))

const { createHelixdProfileStateStartup } = await import('./helixd-profile-state-startup')

beforeEach(() => {
  vi.resetAllMocks()
  ensureActiveHelixProfileMock.mockReturnValue({
    dataFile: '/tmp/profile/helix-data.json',
    stateDatabaseFile: '/tmp/profile/profile-state.db',
    profile: { id: 'profile-1' }
  })
})

describe('helixd profile-state startup', () => {
  it('selects the capable authority once and publishes bounded metadata', async () => {
    const store = { getSettings: vi.fn() }
    createProfileStateStoreForStartupMock.mockReturnValue({
      store,
      authority: { readSerializedState: vi.fn() },
      backend: 'sqlite',
      classification: 'json-only',
      migrated: true
    })

    const result = await createHelixdProfileStateStartup('/tmp/user-data')

    expect(initHelixProfilePathsMock).toHaveBeenCalledOnce()
    expect(ensureActiveHelixProfileMock).toHaveBeenCalledWith('/tmp/user-data')
    expect(initSshHostKeyStoreFileMock).toHaveBeenCalledWith('/tmp/profile/helix-data.json')

    expect(createProfileStateStoreForStartupMock).toHaveBeenCalledWith({
      userDataPath: '/tmp/user-data',
      dataFile: '/tmp/profile/helix-data.json',
      databaseFile: '/tmp/profile/profile-state.db',
      profileId: 'profile-1',
      runtime: 'helixd',
      storageAuthority: 'runtime'
    })
    expect(result.store).toBe(store)
    expect(result.authority).toEqual({
      backend: 'sqlite',
      classification: 'json-only',
      authority_mode: 'sqlite-established',
      runtime: 'helixd',
      migrated: true
    })
    expect(emitMock).toHaveBeenCalledWith(result.authority)
  })

  it('publishes nothing before the profile writer is ready', async () => {
    let refuse = (_error: Error) => {}
    createProfileStateStoreForStartupMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          refuse = reject
        })
    )
    const startup = createHelixdProfileStateStartup('/tmp/user-data')
    const failure = new Error('writer startup refused')
    const rejected = expect(startup).rejects.toBe(failure)
    expect(initSshHostKeyStoreFileMock).not.toHaveBeenCalled()
    expect(emitMock).not.toHaveBeenCalled()
    refuse(failure)
    await rejected
  })

  it('closes a ready writer if sidecar initialization fails', async () => {
    const store = { freezeWritesAsync: vi.fn(async () => {}) }
    createProfileStateStoreForStartupMock.mockResolvedValueOnce({
      store,
      backend: 'sqlite',
      classification: 'sqlite-only',
      migrated: false
    })
    const failure = new Error('sidecar initialization refused')
    initSshHostKeyStoreFileMock.mockImplementationOnce(() => {
      throw failure
    })
    await expect(createHelixdProfileStateStartup('/tmp/user-data')).rejects.toBe(failure)
    expect(store.freezeWritesAsync).toHaveBeenCalledOnce()
    expect(emitMock).not.toHaveBeenCalled()
  })
})
