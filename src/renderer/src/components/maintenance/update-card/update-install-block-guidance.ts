import { translate } from '@/i18n/i18n'
import type { UpdateInstallBlock } from '../../../../../shared/update-status-types'

export function getUpdateInstallBlockGuidance(block: UpdateInstallBlock): {
  title: string
  summary: string
  explainer: string
} {
  if (block.reason === 'busy') {
    return {
      title: translate('updates.installBlock.busyTitle', 'Another Helix is updating'),
      summary: translate(
        'updates.installBlock.busySummary',
        'An update is already being installed by another Helix instance.'
      ),
      explainer: translate(
        'updates.installBlock.busyGuidance',
        'Wait a moment, then retry. Your downloaded update is ready.'
      )
    }
  }
  if (block.reason === 'unresponsive') {
    return {
      title: translate('updates.installBlock.unresponsiveTitle', 'Waiting for background servers'),
      summary: translate(
        'updates.installBlock.unresponsiveSummary',
        'Helix could not finish pausing its background servers for the update.'
      ),
      explainer: translate(
        'updates.installBlock.unresponsiveGuidance',
        'Stop it from the terminal or service that started it, then retry. Connected devices will disconnect.'
      )
    }
  }
  if (block.instances.length > 0 && block.instances.every(({ kind }) => kind === 'browser')) {
    // A helper an older helixd runs never pauses for installs; ending it leaves helixd and terminals up.
    return {
      title: translate('updates.installBlock.readyTitle', 'Your update is ready'),
      summary: translate(
        'updates.installBlock.browserSummary',
        "A background Helix server's browser is still using this app."
      ),
      explainer: translate(
        'updates.installBlock.browserGuidance',
        'End the process below, then retry: its server keeps running without a browser. If another computer uses this Mac as an SSH host, updating Helix there lets the browser pause for updates on its own.'
      )
    }
  }
  const hasServers = block.instances.some(({ kind }) => kind === 'server' || kind === 'browser')
  const onlyServers =
    block.instances.length > 0 &&
    block.instances.every(({ kind }) => kind === 'server' || kind === 'browser')
  return {
    title: translate('updates.installBlock.readyTitle', 'Your update is ready'),
    summary: onlyServers
      ? translate(
          'updates.installBlock.serverSummary',
          'A background Helix server is still using this app.'
        )
      : translate(
          'updates.installBlock.instanceSummary',
          'Another Helix instance is still using this app.'
        ),
    explainer: onlyServers
      ? translate(
          'updates.installBlock.serverGuidance',
          'Stop the server from the terminal or service that started it, then retry. Connected devices will disconnect.'
        )
      : hasServers
        ? translate(
            'updates.installBlock.mixedGuidance',
            'Close any other Helix windows and stop the server from the terminal or service that started it. Connected devices will disconnect. Then retry.'
          )
        : translate(
            'updates.installBlock.instanceGuidance',
            'Quit other Helix instances, then retry. Your downloaded update will be kept ready.'
          )
  }
}
