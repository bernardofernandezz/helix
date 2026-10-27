import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { HELIXD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/helixd-managed-launch-env'
import {
  HELIXD_COMPILE_CACHE_DIRNAME,
  enableManagedHelixdCompileCache,
  helixdCompileCacheEnv
} from './helixd-compile-cache'

const managed = {
  [HELIXD_MANAGED_ACTIVATION_ROOT_ENV]: '/home/u/.helix-remote/.fence'
}

describe('managed helixd compile cache', () => {
  it('caches inside a managed slot, where slot GC removes it with the slot', () => {
    const enableCompileCache = vi.fn()
    enableManagedHelixdCompileCache('/home/u/.helix-remote/helixd-1+ab', managed, {
      enableCompileCache
    })
    expect(enableCompileCache).toHaveBeenCalledWith(
      join('/home/u/.helix-remote/helixd-1+ab', HELIXD_COMPILE_CACHE_DIRNAME)
    )
  })

  it('never writes into a slot no client manages, such as a packaged app', () => {
    const enableCompileCache = vi.fn()
    enableManagedHelixdCompileCache('/Applications/Helix.app/helixd', {}, { enableCompileCache })
    expect(enableCompileCache).not.toHaveBeenCalled()
  })

  it('starts as before on a runtime without the API or with an unwritable slot', () => {
    expect(() => enableManagedHelixdCompileCache('/slot', managed, {})).not.toThrow()
    const enableCompileCache = vi.fn(() => {
      throw new Error('EACCES')
    })
    expect(() =>
      enableManagedHelixdCompileCache('/slot', managed, { enableCompileCache })
    ).not.toThrow()
  })

  it('hands the preflight child the slot cache only when this process enabled one', () => {
    const enabled = { getCompileCacheDir: () => '/slot/x/v24' }
    expect(helixdCompileCacheEnv('/slot', enabled, managed)).toEqual({
      NODE_COMPILE_CACHE: join('/slot', HELIXD_COMPILE_CACHE_DIRNAME)
    })
    expect(
      helixdCompileCacheEnv('/slot', { getCompileCacheDir: () => undefined }, managed)
    ).toEqual({})
    expect(helixdCompileCacheEnv('/slot', {}, managed)).toEqual({})
    expect(helixdCompileCacheEnv('/slot', enabled, {})).toEqual({})
  })
})
