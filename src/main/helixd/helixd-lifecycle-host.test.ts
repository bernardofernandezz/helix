import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./helixd-browser-startup', () => ({
  startHelixdBrowserProvider: () => ({ ready: Promise.resolve(), stop: async () => {} })
}))

import { HELIXD_LOCK_FILE_NAME, readHelixdInstanceLockRecord } from './helixd-instance-lock'
import { startHelixdWithHost } from './helixd-lifecycle'
import { isDesktopBrowserBridgeHostEnabled } from '../runtime/desktop-browser-bridge/desktop-browser-bridge-registry'
import { HELIXD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/helixd-managed-launch-env'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function dataRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'helixd-lifecycle-host-'))
  roots.push(root)
  return root
}

describe('startHelixdWithHost', () => {
  it('names the instance a managed stop must address, and releases its lock on a clean stop', async () => {
    const root = dataRoot()
    const handle = await startHelixdWithHost(
      root,
      async () => ({}),
      () => {}
    )
    expect(readHelixdInstanceLockRecord(handle.instance.lockPath)).toMatchObject({
      pid: handle.instance.pid,
      nonce: handle.instance.nonce
    })
    await handle.stop()
    expect(existsSync(join(root, HELIXD_LOCK_FILE_NAME))).toBe(false)
  })

  it('keeps the instance lock when a runtime writer could not be stopped', async () => {
    const root = dataRoot()
    const failure = new Error('profile writer still running')
    const handle = await startHelixdWithHost(
      root,
      async (registerCleanup) => {
        registerCleanup(() => {
          throw failure
        })
        return {}
      },
      () => {}
    )
    await expect(handle.stop()).rejects.toBe(failure)
    expect(existsSync(join(root, HELIXD_LOCK_FILE_NAME))).toBe(true)
  })

  it('keeps the instance lock when a quit handler fails', async () => {
    const root = dataRoot()
    const handle = await startHelixdWithHost(
      root,
      async () => ({}),
      () => {
        throw new AggregateError([new Error('handler')], 'helixd_quit_handlers_failed')
      }
    )
    await expect(handle.stop()).rejects.toThrow('helixd_quit_handlers_failed')
    expect(existsSync(join(root, HELIXD_LOCK_FILE_NAME))).toBe(true)
  })

  it.each([
    ['a managed launch', { [HELIXD_MANAGED_ACTIVATION_ROOT_ENV]: '/home/me/.helix-server' }, true],
    ['a server the user started', {}, false]
  ])('takes desktop browser bridge commands only for %s', async (_name, env, expected) => {
    vi.stubEnv(HELIXD_MANAGED_ACTIVATION_ROOT_ENV, env[HELIXD_MANAGED_ACTIVATION_ROOT_ENV] ?? '')
    try {
      const handle = await startHelixdWithHost(
        dataRoot(),
        async () => ({}),
        () => {}
      )
      expect(isDesktopBrowserBridgeHostEnabled()).toBe(expected)
      await handle.stop()
      expect(isDesktopBrowserBridgeHostEnabled()).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
