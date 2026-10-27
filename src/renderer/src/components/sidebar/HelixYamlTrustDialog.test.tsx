import { renderToStaticMarkup } from 'react-dom/server'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: {
    activeModal: 'confirm-helix-yaml-hooks' as string | null,
    modalData: {} as Record<string, unknown>,
    closeModal: vi.fn(),
    markHelixHookScriptConfirmed: vi.fn(),
    markHelixHookRepoAlwaysTrusted: vi.fn()
  }
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    {
      getState: () => mocks.state
    }
  )
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button {...props}>{children}</button>
  )
}))

// Use English fallbacks so this JSX-whitespace regression is independent of locale loading.
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

function decodeHtml(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

describe('HelixYamlTrustDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.activeModal = 'confirm-helix-yaml-hooks'
    mocks.state.modalData = {
      repoId: 'repo-1',
      repoName: 'helix',
      scriptKind: 'setup',
      scriptContent: 'node config/scripts/run-internal-dev-setup.mjs\npnpm install',
      contentHash: 'hash-1',
      previouslyApproved: false
    }
  })

  it('keeps spaces around helix.yaml and the repo name in the first-run copy', async () => {
    const { default: HelixYamlTrustDialog } = await import('./HelixYamlTrustDialog')
    const text = decodeHtml(renderToStaticMarkup(<HelixYamlTrustDialog />)).replace(/<[^>]+>/g, '')

    expect(text).toContain("This repository's helix.yaml runs on your machine")
    expect(text).toContain('Only run if you trust helix.')
    expect(text).toContain('Always trust helix.yaml in helix')
    expect(text).not.toContain("repository'shelix.yaml")
    expect(text).not.toContain('trusthelix')
    expect(text).not.toContain('trusthelix.yaml')
    expect(text).not.toContain('inhelix')
  })

  it('keeps spaces around helix.yaml when the script changed since last approval', async () => {
    mocks.state.modalData = {
      ...mocks.state.modalData,
      previouslyApproved: true
    }
    const { default: HelixYamlTrustDialog } = await import('./HelixYamlTrustDialog')
    const text = decodeHtml(renderToStaticMarkup(<HelixYamlTrustDialog />)).replace(/<[^>]+>/g, '')

    expect(text).toContain('helix.yaml changed since you last approved')
    expect(text).toContain('Always trust helix.yaml in helix')
    expect(text).not.toContain('Always trusthelix.yaml')
    expect(text).not.toContain('inhelix')
  })
})
