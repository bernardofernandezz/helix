import { vi } from 'vitest'

// Main-owned layout variant: registration must publish once without waiting for a later frame.
vi.mock('../../shared/layout-owner-switch', () => ({ HELIX_LAYOUT_OWNER_IS_MAIN: true }))

await import('./helix-runtime-cold-restore-terminal-membership.test')
