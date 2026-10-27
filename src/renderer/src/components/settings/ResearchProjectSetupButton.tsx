import { useState } from 'react'
import { FlaskConical, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { extractIpcErrorMessage } from '../../lib/ipc-error'
import { Button } from '../ui/button'

type ResearchProjectSetupButtonProps = {
  projectPath: string
  onDone: () => void
}

/** Lays out a local research project and connects its agents to the Helix research tools. */
export function ResearchProjectSetupButton({
  projectPath,
  onDone
}: ResearchProjectSetupButtonProps): React.JSX.Element {
  const [busy, setBusy] = useState(false)

  const setUp = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.api.researchTools.setUpProject({ projectPath })
      if (!result.ok) {
        toast.error(
          translate('helix.researchProject.setupFailed', 'Research tools were not added'),
          { description: result.detail }
        )
        return
      }
      toast.success(
        result.created.length > 0 || result.mcpConfigUpdated
          ? translate('helix.researchProject.ready', 'Research project ready')
          : translate('helix.researchProject.alreadySetUp', 'Research project already set up'),
        {
          description:
            result.created.length > 0
              ? translate('helix.researchProject.created', 'Created {{value}}', {
                  value: result.created.join(', ')
                })
              : undefined
        }
      )
      onDone()
    } catch (error) {
      toast.error(extractIpcErrorMessage(error, 'Failed to set up the research project.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      disabled={busy}
      onClick={() => void setUp()}
    >
      {busy ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : (
        <FlaskConical className="size-3.5" />
      )}
      {translate('helix.researchProject.setUp', 'Set up research project')}
    </Button>
  )
}
