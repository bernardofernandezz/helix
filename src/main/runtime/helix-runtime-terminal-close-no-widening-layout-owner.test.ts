import { vi } from 'vitest'

// Run the pane-close no-widening contract under main-owned layout.
vi.mock('../../shared/layout-owner-switch', () => ({ HELIX_LAYOUT_OWNER_IS_MAIN: true }))

await import('./helix-runtime-terminal-close-no-widening.test')
