// Why: the single security boundary for the bundled CLI — auth-token enforcement, metadata publication, transport orchestration.
import { RuntimeRpcShutdown } from './runtime-rpc/runtime-rpc-shutdown'
import type { HelixRuntimeRpcServerOptions } from './runtime-rpc/runtime-rpc-pairing-types'

export class HelixRuntimeRpcServer extends RuntimeRpcShutdown {
  constructor(options: HelixRuntimeRpcServerOptions) {
    super(options)
  }
}
