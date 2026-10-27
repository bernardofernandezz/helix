import {
  MANAGED_HOOK_TIMEOUT_SECONDS,
  readHooksJson,
  type HooksConfig
} from '../agent-hooks/installer-utils'
import {
  computeTrustKey,
  getCodexExplicitHomeHookSourcePath,
  readHookTrustEntries,
  type CodexEventLabel,
  type CodexHookTrustState
} from './config-toml-trust'
import {
  CODEX_EVENTS,
  CODEX_EVENT_LABEL,
  computeHelixCodexHookHashes,
  getCodexConfigTomlPath,
  getConfigPath,
  getSystemCodexConfigTomlPath
} from './codex-hook-definition'
import { readEveryKnownCodexHookHashes } from './codex-hook-hash-lookup'
import { getSystemCodexHomePath } from './codex-home-paths'
import { readLedgerHelixHashes } from './codex-managed-trust-reconciliation'
import {
  getRealHomeHookKeySourcePaths,
  getRealHomeHooksJsonPath
} from './codex-real-home-hooks-json'
import type { CodexHookHashes } from './codex-hook-trust-derivation'

export type CodexHookHome = {
  homePath: string
  hooksJsonPath: string
  tomlPath: string
  keySourcePaths: readonly [string, ...string[]]
}

export function getManagedCodexHookHome(runtimeHomePath: string): CodexHookHome {
  const hooksJsonPath = getConfigPath(runtimeHomePath)
  return {
    homePath: runtimeHomePath,
    hooksJsonPath,
    tomlPath: getCodexConfigTomlPath(runtimeHomePath),
    keySourcePaths: [getCodexExplicitHomeHookSourcePath(hooksJsonPath)]
  }
}

/** In-place homes keep user hooks and approvals in their original slots. */
export function getInPlaceCodexHookHome(homePath: string): CodexHookHome {
  const hooksJsonPath = getConfigPath(homePath)
  return {
    homePath,
    hooksJsonPath,
    tomlPath: getCodexConfigTomlPath(homePath),
    keySourcePaths: getRealHomeHookKeySourcePaths(hooksJsonPath)
  }
}

export function getRealHomeCodexHookHome(): CodexHookHome {
  return {
    homePath: getSystemCodexHomePath(),
    hooksJsonPath: getRealHomeHooksJsonPath(),
    tomlPath: getSystemCodexConfigTomlPath(),
    keySourcePaths: getRealHomeHookKeySourcePaths()
  }
}

type CodexEventName = (typeof CODEX_EVENTS)[number]
type HelixEntrySlot = { groupIndex: number; handlerIndex: number }
type HelixEntryApproval = CodexHookTrustState & { key: string; trustedHash: string }

export function findHelixEntrySlots(
  hooks: HooksConfig['hooks'],
  command: string
): Map<CodexEventName, HelixEntrySlot> {
  return new Map(
    CODEX_EVENTS.flatMap((eventName) => {
      const definitions = Array.isArray(hooks?.[eventName]) ? hooks[eventName] : []
      const slot = definitions.flatMap((definition, groupIndex) =>
        (definition.hooks ?? []).flatMap((hook, handlerIndex) =>
          hook.command === command ? [{ groupIndex, handlerIndex }] : []
        )
      )[0]
      return slot ? [[eventName, slot] as const] : []
    })
  )
}

/** Include approvals under every source-path spelling Codex uses. */
export function approvalsAtHelixEntries(
  trustStates: ReadonlyMap<string, CodexHookTrustState>,
  slots: ReadonlyMap<CodexEventName, HelixEntrySlot>,
  keySourcePaths: readonly string[],
  command: string
): Map<CodexEventLabel, HelixEntryApproval[]> {
  return new Map(
    [...slots].map(([eventName, slot]) => {
      const eventLabel = CODEX_EVENT_LABEL[eventName]
      const approvals = keySourcePaths.flatMap((sourcePath) => {
        const key = computeTrustKey({ sourcePath, eventLabel, command, ...slot })
        const state = trustStates.get(key)
        return state?.trustedHash ? [{ ...state, key, trustedHash: state.trustedHash }] : []
      })
      return [eventLabel, approvals]
    })
  )
}

// Positional keys may hold removed user hooks' approvals; only recognize known Helix hashes.
export function readKnownHelixHashes(home: CodexHookHome, command: string): CodexHookHashes[] {
  return [
    computeHelixCodexHookHashes(command),
    ...readEveryKnownCodexHookHashes(),
    ...readLedgerHelixHashes(home.homePath, command, MANAGED_HOOK_TIMEOUT_SECONDS)
  ]
}

export function isKnownHelixHash(
  knownHelixHashes: readonly CodexHookHashes[],
  eventLabel: CodexEventLabel,
  trustedHash: string | undefined
): boolean {
  return (
    trustedHash !== undefined &&
    knownHelixHashes.some((hashes) => hashes[eventLabel] === trustedHash)
  )
}

/** Until Codex answers, prefer existing known approvals over local hashes. */
export function readStopgapHelixHashes(home: CodexHookHome, command: string): CodexHookHashes {
  let trustStates: ReadonlyMap<string, CodexHookTrustState>
  try {
    trustStates = readHookTrustEntries(home.tomlPath)
  } catch {
    trustStates = new Map()
  }
  return findStopgapHelixHashes({
    trustStates,
    hooks: readHooksJson(home.hooksJsonPath)?.hooks,
    keySourcePaths: home.keySourcePaths,
    command,
    knownHelixHashes: readKnownHelixHashes(home, command)
  })
}

export function findStopgapHelixHashes(found: {
  trustStates: ReadonlyMap<string, CodexHookTrustState>
  hooks: HooksConfig['hooks']
  keySourcePaths: readonly string[]
  command: string
  knownHelixHashes: readonly CodexHookHashes[]
}): CodexHookHashes {
  const slots = findHelixEntrySlots(found.hooks, found.command)
  const approvals = approvalsAtHelixEntries(
    found.trustStates,
    slots,
    found.keySourcePaths,
    found.command
  )
  return {
    ...computeHelixCodexHookHashes(found.command),
    ...Object.fromEntries(
      [...approvals].flatMap(([eventLabel, held]) => {
        // Codex hashes content, so a known hash survives position changes.
        const approval = held.find(({ trustedHash }) =>
          isKnownHelixHash(found.knownHelixHashes, eventLabel, trustedHash)
        )
        return approval ? [[eventLabel, approval.trustedHash]] : []
      })
    )
  }
}
