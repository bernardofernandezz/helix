// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { HelixCloudSignInProgress } from '../../../shared/helix-profiles'
import { HelixSignInButton, HelixSignInWaitNotice } from './HelixSignInProgress'

type SignInState = {
  helixProfileSignInProgress: HelixCloudSignInProgress | null
  connectCurrentHelixProfile: Mock
}

const mocks = vi.hoisted((): { state: SignInState; toastError: Mock; toastSuccess: Mock } => ({
  state: { helixProfileSignInProgress: null, connectCurrentHelixProfile: vi.fn() },
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('../store', () => ({
  useAppStore: (selector: (state: SignInState) => unknown) => selector(mocks.state)
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess }
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

const LINK = 'https://login.example/authorize?state=abc'

describe('Helix sign-in progress', () => {
  const writeClipboardText = vi.fn()
  const cancelSignIn = vi.fn()

  beforeEach(() => {
    mocks.state.helixProfileSignInProgress = null
    mocks.state.connectCurrentHelixProfile.mockReset()
    mocks.toastError.mockReset()
    mocks.toastSuccess.mockReset()
    writeClipboardText.mockReset().mockResolvedValue(undefined)
    cancelSignIn.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ui: { writeClipboardText }, helixProfiles: { cancelSignIn } }
    })
  })

  afterEach(() => cleanup())

  it('starts a sign-in from the button', async () => {
    render(<HelixSignInButton>Sign in to Helix</HelixSignInButton>)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in to Helix' }))

    expect(mocks.state.connectCurrentHelixProfile).toHaveBeenCalledOnce()
  })

  it('greys the button out as Signing in… while a sign-in is in flight', () => {
    mocks.state.helixProfileSignInProgress = { link: null }
    render(<HelixSignInButton>Sign in to Helix</HelixSignInButton>)

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled()
  })

  it('omits the waiting notice until the sign-in link is available', () => {
    mocks.state.helixProfileSignInProgress = { link: null }
    const { container } = render(<HelixSignInWaitNotice />)
    expect(container).toBeEmptyDOMElement()
  })

  it('copies the waiting link', async () => {
    mocks.state.helixProfileSignInProgress = { link: LINK }
    render(<HelixSignInWaitNotice />)
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for sign-in in your browser')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy sign-in link' }))

    expect(writeClipboardText).toHaveBeenCalledWith(LINK)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Sign-in link copied')
  })

  it('reports a failed clipboard write', async () => {
    mocks.state.helixProfileSignInProgress = { link: LINK }
    writeClipboardText.mockRejectedValue(new Error('denied'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<HelixSignInWaitNotice />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy sign-in link' }))

    expect(mocks.toastError).toHaveBeenCalledWith('Could not copy the link.')
  })

  it('cancels the browser wait', async () => {
    mocks.state.helixProfileSignInProgress = { link: LINK }
    render(<HelixSignInWaitNotice />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }))

    expect(cancelSignIn).toHaveBeenCalledOnce()
  })
})
