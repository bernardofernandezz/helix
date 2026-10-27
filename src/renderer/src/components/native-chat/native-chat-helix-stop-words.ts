import { translate } from '@/i18n/i18n'
import type { AgentSessionHelixStopCause } from '../../../../shared/agent-session-helix-stop'
import { joinSentences } from '../../../../shared/sentence-joining'

const STOPPED: Record<AgentSessionHelixStopCause, (machine: string) => string> = {
  update: (machine) =>
    translate(
      'components.native-chat.notices.helixStopUpdate',
      'Helix on {{machine}} restarted for an update while this response was in progress.',
      { machine }
    ),
  quit: (machine) =>
    translate(
      'components.native-chat.notices.helixStopQuit',
      'Helix on {{machine}} was closed while this response was in progress.',
      { machine }
    ),
  crash: (machine) =>
    translate(
      'components.native-chat.notices.helixStopCrash',
      'Helix on {{machine}} stopped unexpectedly while this response was in progress.',
      { machine }
    )
}

// A remote graceful stop is a server stop or a shared desktop's quit; "stopped" is true of both.
const remoteQuit = (machine: string): string =>
  translate(
    'components.native-chat.notices.helixStopRemote',
    'Helix on {{machine}} stopped while this response was in progress.',
    { machine }
  )

function stoppedSentence(
  cause: AgentSessionHelixStopCause,
  machine: string,
  remoteHost: boolean
): string {
  return cause === 'quit' && remoteHost ? remoteQuit(machine) : STOPPED[cause](machine)
}

/** Base wording on host continuation support so the sentence stays stable as the button changes. */
export function nativeChatHelixStopRowText(
  cause: AgentSessionHelixStopCause,
  machine: string,
  options: { continueAvailable: boolean; remoteHost: boolean }
): string {
  const stopped = stoppedSentence(cause, machine, options.remoteHost)
  return options.continueAvailable
    ? stopped
    : joinSentences([
        stopped,
        translate(
          'components.native-chat.notices.helixStopCanContinue',
          'You can continue in this conversation.'
        )
      ])
}
