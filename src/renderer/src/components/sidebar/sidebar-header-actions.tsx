import React, { useCallback } from 'react'
import { FlaskConical, FolderPlus, Plus, type LucideIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatOptionalPrimaryShortcutLabel } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import { startResearchProject } from '@/lib/research-project-start'
import { openWorkspaceCreationComposerWithTourHandoff } from '../contextual-tours/workspace-creation-tour-handoff'
import SidebarWorkspaceOptionsMenu from './SidebarWorkspaceOptionsMenu'

function ProjectActionButton({
  label,
  icon: Icon,
  onClick,
  preserveWorkspaceBoardOpen
}: {
  label: string
  icon: LucideIcon
  onClick: () => void
  preserveWorkspaceBoardOpen: boolean
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          className="text-muted-foreground"
          aria-label={label}
          data-workspace-board-preserve-open={preserveWorkspaceBoardOpen ? '' : undefined}
          onClick={onClick}
        >
          <Icon className="size-3.5" strokeWidth={2.25} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function NewWorkspaceButton({
  preserveWorkspaceBoardOpen
}: {
  preserveWorkspaceBoardOpen: boolean
}): React.JSX.Element {
  const keybindings = useAppStore((s) => s.keybindings)
  // Show the primary create shortcut so aliases do not crowd the tooltip.
  const shortcutLabel = formatOptionalPrimaryShortcutLabel('workspace.create', keybindings)
  const label = translate('auto.components.sidebar.SidebarHeader.92154beb7e', 'New workspace')

  const handleCreateWorkspace = useCallback(() => {
    openWorkspaceCreationComposerWithTourHandoff()
  }, [])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          className="text-muted-foreground"
          aria-label={label}
          data-workspace-board-preserve-open={preserveWorkspaceBoardOpen ? '' : undefined}
          data-contextual-tour-target="workspace-create-control"
          onClick={handleCreateWorkspace}
        >
          <Plus className="size-3.5" strokeWidth={2.25} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
        {shortcutLabel ? <span className="ml-1.5 text-background/60">{shortcutLabel}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}

export function SidebarHeaderActions({
  onWorkspaceBoardMenuOpenChange,
  agentsViewActive = false,
  activityOptionsTarget
}: {
  onWorkspaceBoardMenuOpenChange: (open: boolean) => void
  agentsViewActive?: boolean
  activityOptionsTarget?: React.Ref<HTMLDivElement>
}): React.JSX.Element {
  const openModal = useAppStore((s) => s.openModal)
  return (
    <div className="flex shrink-0 items-center gap-1" data-sidebar-header-actions="">
      <div ref={activityOptionsTarget} className="flex size-6 shrink-0 items-center">
        {agentsViewActive ? null : (
          <SidebarWorkspaceOptionsMenu
            preserveWorkspaceBoardOpen
            onMenuOpenChange={onWorkspaceBoardMenuOpenChange}
          />
        )}
      </div>
      <ProjectActionButton
        label={translate('helix.researchProject.new', 'New research project')}
        icon={FlaskConical}
        onClick={() => void startResearchProject()}
        preserveWorkspaceBoardOpen
      />
      <ProjectActionButton
        label={translate('auto.components.sidebar.SidebarHeader.addProject', 'Add project')}
        icon={FolderPlus}
        onClick={() => openModal('add-repo')}
        preserveWorkspaceBoardOpen
      />
      <NewWorkspaceButton preserveWorkspaceBoardOpen />
    </div>
  )
}
