import {
  HELIXD_NODE_RUNTIME_DIR_PREFIX,
  HELIXD_NODE_RUNTIME_POSIX_EXECUTABLE,
  HELIXD_RUNTIMES_DIRNAME
} from '../../../shared/helixd-artifacts'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { RELAY_REMOTE_DIR } from '../../ssh/remote-exec/remote-frame-protocol'
import { HELIXD_MACHINE_HOMES_DIRNAME } from '../host-state/helixd-machine-home'

/** POSIX shell glob words for helixd's pinned Node runtimes; machine homes may hold other architectures, so callers must self-test each match. */
export function helixdPosixNodeRuntimeGlobs(): [string, string] {
  const store = `${RELAY_REMOTE_DIR}/${HELIXD_RUNTIMES_DIRNAME}/${HELIXD_NODE_RUNTIME_DIR_PREFIX}`
  const executable = `/${HELIXD_NODE_RUNTIME_POSIX_EXECUTABLE}`
  const machineStores = `${RELAY_REMOTE_DIR}/${HELIXD_MACHINE_HOMES_DIRNAME}/`
  return [
    `"$HOME"/${quotePosixShell(store)}*${quotePosixShell(executable)}`,
    `"$HOME"/${quotePosixShell(machineStores)}*/${quotePosixShell(store)}*${quotePosixShell(executable)}`
  ]
}
