import {
  HELIXD_BUILD_TARGET_FILENAME,
  HELIXD_LAUNCHER_FILENAME,
  HELIXD_SERVER_ENTRY_FILENAME,
  HELIXD_NODE_RUNTIME_DIR_PREFIX,
  HELIXD_NODE_RUNTIME_MARKER_FILENAME,
  HELIXD_NODE_RUNTIME_POSIX_EXECUTABLE,
  HELIXD_RUNTIMES_DIRNAME,
  helixdBunRuntimeFilename
} from '../../../shared/helixd-artifacts'
import { assertPosixHelixdHost } from './helixd-remote-host-support'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

// Assign the long slot path once to reduce command size on the wire.
function assignHelixdSlot(directory: string): string {
  return `helixd_slot=${quotePosixShell(directory.replace(/\/+$/, ''))}; `
}

// Rollback must still accept legacy single-entry slots.
export function selectHelixdSlotEntryCommand(host: RemoteHostPlatform, directory: string): string {
  assertPosixHelixdHost(host)
  const server = `"$helixd_slot"/${quotePosixShell(HELIXD_SERVER_ENTRY_FILENAME)}`
  const launcher = `"$helixd_slot"/${quotePosixShell(HELIXD_LAUNCHER_FILENAME)}`
  return `${assignHelixdSlot(directory)}if [ -f ${server} ]; then helixd_entry=${server}; else helixd_entry=${launcher}; fi`
}

/** Set $helixd_runtime or exit 78; callers decide what an absent marker means. */
export function helixdNodeSlotRuntimeCommand(host: RemoteHostPlatform, directory: string): string {
  assertPosixHelixdHost(host)
  const nodeMarker = `"$helixd_slot"/${quotePosixShell(HELIXD_NODE_RUNTIME_MARKER_FILENAME)}`
  const nodeRuntimePrefix = `"\${helixd_slot%/*}"/${quotePosixShell(
    `${HELIXD_RUNTIMES_DIRNAME}/${HELIXD_NODE_RUNTIME_DIR_PREFIX}`
  )}`
  const nodeExecutable = quotePosixShell(`/${HELIXD_NODE_RUNTIME_POSIX_EXECUTABLE}`)
  return (
    `${assignHelixdSlot(directory)}helixd_node_sha=$(cat ${nodeMarker}) || exit 78; ` +
    // The digest becomes a path segment; reject non-SHA256 values.
    // Leading ( keeps the case pattern parseable inside command substitution.
    'case "$helixd_node_sha" in ("" | *[!0-9a-f]*) exit 78;; esac; ' +
    '[ "${#helixd_node_sha}" -eq 64 ] || exit 78; ' +
    `helixd_runtime=${nodeRuntimePrefix}"$helixd_node_sha"${nodeExecutable}; ` +
    '[ -x "$helixd_runtime" ] || exit 78; '
  )
}

/** Legacy host Node fallback must never hide an incomplete Node or Bun slot. */
export function selectHelixdSlotRuntimeCommand(
  host: RemoteHostPlatform,
  directory: string,
  legacyNodePath: string
): string {
  assertPosixHelixdHost(host)
  const nodeMarker = quotePosixShell(
    joinRemotePath(host, directory, HELIXD_NODE_RUNTIME_MARKER_FILENAME)
  )
  const runtime = quotePosixShell(
    joinRemotePath(host, directory, helixdBunRuntimeFilename(host.os))
  )
  const target = quotePosixShell(joinRemotePath(host, directory, HELIXD_BUILD_TARGET_FILENAME))
  return (
    `if [ -e ${nodeMarker} ]; then ${helixdNodeSlotRuntimeCommand(host, directory)}` +
    `elif [ -e ${target} ] || [ -e ${runtime} ]; then ` +
    `[ -x ${runtime} ] || exit 78; helixd_runtime=${runtime}; ` +
    `else helixd_runtime=${quotePosixShell(legacyNodePath)}; fi`
  )
}
