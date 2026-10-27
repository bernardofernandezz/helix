import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

/** Copies the chat's Helix session ID from the host: `helix_session_id:<root>`, which `/clear` keeps. */
export function NativeChatCopyHelixSessionIdMenuItem({
  resolveHelixSessionId
}: {
  resolveHelixSessionId: () => Promise<string | null>
}): React.JSX.Element {
  const copyHelixSessionId = async (): Promise<void> => {
    try {
      const helixSessionId = await resolveHelixSessionId()
      if (!helixSessionId) {
        throw new Error('no Helix session ID')
      }
      await window.api.ui.writeClipboardText(helixSessionId)
      toast.success(
        translate(
          'components.native-chat.contextMenu.helixSessionIdCopied',
          'Helix session ID copied'
        )
      )
    } catch {
      toast.error(
        translate(
          'components.native-chat.contextMenu.helixSessionIdCopyFailed',
          'Unable to copy Helix session ID'
        )
      )
    }
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem onSelect={() => void copyHelixSessionId()}>
          <Copy />
          {translate(
            'components.native-chat.contextMenu.copyHelixSessionId',
            'Copy Helix Session ID'
          )}
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-[220px]">
        {translate(
          'components.native-chat.contextMenu.helixSessionIdTooltip',
          "Helix's ID for this chat, separate from the agent CLI's own session ID. Agents use it to refer to each other through Helix."
        )}
      </TooltipContent>
    </Tooltip>
  )
}
