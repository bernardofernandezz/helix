import { describe, expect, it, vi } from 'vitest'
import type { HelixdInstanceLock } from '../helixd/helixd-instance-lock'
import { HelixdInstanceLockError } from '../helixd/helixd-data-root-privacy'
import { acquireDesktopProfileInstanceLock } from './desktop-profile-instance-lock'

describe('the desktop share of the profile instance lock', () => {
  it('takes the lock as the desktop', () => {
    const lock: HelixdInstanceLock = Object.assign(Object.create(null), { release: vi.fn() })
    const acquire = vi.fn(() => lock)
    expect(acquireDesktopProfileInstanceLock('/profile', acquire)).toEqual({
      state: 'acquired',
      lock
    })
    expect(acquire).toHaveBeenCalledWith('/profile', { role: 'desktop' })
  })

  // a holder this machine cannot judge (a shared home) may be running, so it is held too.
  it.each(['helixd_instance_lock_held', 'helixd_instance_lock_holder_unverifiable'] as const)(
    'refuses while an helixd may serve the profile (%s), and says so',
    (code) => {
      const write = vi.fn()
      const result = acquireDesktopProfileInstanceLock(
        '/profile',
        () => {
          throw new HelixdInstanceLockError(code, 'Another helixd (pid 7) ...')
        },
        write
      )
      expect(result).toEqual({
        state: 'held',
        message: 'Another helixd (pid 7) ...'
      })
      expect(write).toHaveBeenCalledWith(2, '[single-instance] Another helixd (pid 7) ...\n')
    }
  )

  it('still starts when the lock cannot be taken for any other reason', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      acquireDesktopProfileInstanceLock('/profile', () => {
        throw new HelixdInstanceLockError('helixd_instance_lock_unreadable', 'unreadable')
      })
    ).toEqual({ state: 'unavailable' })
  })
})
