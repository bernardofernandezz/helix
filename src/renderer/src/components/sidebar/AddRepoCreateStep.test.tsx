import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from '@/components/ui/dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CreateStep } from './AddRepoCreateStep'

function renderCreateStep({
  createName = '',
  createParent = '/Users/alice/helix/projects',
  parentDefaultPending = false
}: {
  createName?: string
  createParent?: string
  parentDefaultPending?: boolean
} = {}): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <Dialog open>
        <CreateStep
          createName={createName}
          createParent={createParent}
          createError={null}
          isCreating={false}
          defaultParent="/Users/alice/helix/projects"
          runtimeParentStatus="idle"
          parentDefaultPending={parentDefaultPending}
          onNameChange={vi.fn()}
          onParentChange={vi.fn()}
          onPickParent={vi.fn()}
          onCreate={vi.fn()}
        />
      </Dialog>
    </TooltipProvider>
  )
}

describe('CreateStep', () => {
  it('renders the name-first create UI with advanced controls collapsed', () => {
    const html = renderCreateStep()

    expect(html).toContain('Create a new project')
    expect(html).toContain('Name')
    expect(html).toContain('Research project in ~/helix/projects')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Project kind')
    expect(html).not.toContain('Location</span>')
    expect(html).not.toContain('aria-label="Browse host filesystem"')
  })

  it('disables create while an auto-filled parent belongs to a previous target', () => {
    const html = renderCreateStep({
      createName: 'demo-project',
      parentDefaultPending: true
    })

    expect(html).toContain('disabled=""')
  })
})
