import { join } from 'node:path'
import {
  getEndpointFileName,
  writeEndpointFile
} from '../../../shared/agent-hook-listener/endpoint-publication'
import {
  HELIX_HOOK_PROTOCOL_VERSION,
  HELIX_HOOK_RAW_JSON_TRANSPORT
} from '../../../shared/agent-hook-types'
import { AgentHookServerIngestRemote } from './server-ingest-remote'

export abstract class AgentHookServerRuntimeEnv extends AgentHookServerIngestRemote {
  buildPtyEnv(): Record<string, string> {
    if (!this.statusHooksEnabled || this.port <= 0 || !this.token) {
      return {}
    }
    const env: Record<string, string> = {
      HELIX_AGENT_HOOK_PORT: String(this.port),
      HELIX_AGENT_HOOK_TOKEN: this.token,
      HELIX_AGENT_HOOK_ENV: this.env,
      HELIX_AGENT_HOOK_VERSION: HELIX_HOOK_PROTOCOL_VERSION,
      HELIX_AGENT_HOOK_OPENCODE_TUI: '1',
      HELIX_AGENT_HOOK_TRANSPORT: HELIX_HOOK_RAW_JSON_TRANSPORT
    }
    // Hooks read the endpoint on invocation; dev instances must not steal each other's hooks.
    if (this.endpointFileWritten && this.endpointFilePathCache) {
      env.HELIX_AGENT_HOOK_ENDPOINT = this.endpointFilePathCache
    }
    return env
  }

  get endpointFilePath(): string | null {
    return this.endpointFilePathCache
  }

  get lastStatusPath(): string | null {
    return this.lastStatusFilePath
  }

  protected maybeWriteEndpointFile(): void {
    if (!this.endpointDir || !this.endpointFilePathCache) {
      return
    }
    this.endpointFileWritten = false
    const ok = writeEndpointFile(this.endpointDir, this.endpointFilePathCache, {
      port: this.port,
      token: this.token,
      env: this.env,
      version: HELIX_HOOK_PROTOCOL_VERSION,
      openCodeTui: true,
      transport: HELIX_HOOK_RAW_JSON_TRANSPORT
    })
    this.endpointFileWritten = ok
  }

  protected configureEndpointPaths(userDataPath: string, endpointNamespace?: string): void {
    // Dev endpoints are per instance; packaged endpoints stay stable for PTY reconnect.
    this.endpointDir = endpointNamespace
      ? join(userDataPath, 'agent-hooks', endpointNamespace)
      : join(userDataPath, 'agent-hooks')
    this.endpointFilePathCache = join(this.endpointDir, getEndpointFileName())
    this.lastStatusFilePath = join(this.endpointDir, 'last-status.json')
  }
}
