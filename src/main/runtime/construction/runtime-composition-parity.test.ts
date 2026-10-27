import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RUNTIME_CAPABILITIES } from '../../../shared/protocol-version'
import { SSH_TARGET_MANAGEMENT_RUNTIME_CAPABILITY } from '../../../shared/ssh-target-management'
import { SKILL_INSTALL_CAPABILITY } from '../../../shared/skill-install-capability'

/** Optional services can silently diverge between Electron/helixd.
 * Compare constructor args/options, runtime/RPC setters and preflight host ports; require reasons for differences. */

type Root = 'electron' | 'helixd'

type DeclaredDifference = {
  wiring: string
  missingOn: Root
  reason: string
  advertisedUnserved?: readonly string[]
}

const DECLARED_HOST_DIFFERENCES: readonly DeclaredDifference[] = [
  {
    wiring: 'runtime.setArtifactService',
    missingOn: 'helixd',
    reason: 'Artifact sharing uses the desktop sign-in; a headless host has none yet.'
  },
  {
    wiring: 'runtime.setSkillCloudService',
    missingOn: 'helixd',
    reason: 'Skill sharing uses the desktop sign-in; installs from Git still work on helixd.',
    advertisedUnserved: [SKILL_INSTALL_CAPABILITY]
  },
  {
    wiring: 'registerSshHandlers',
    missingOn: 'helixd',
    reason: 'helixd has no SSH stack; its SSH target methods refuse with an accurate message.',
    advertisedUnserved: [SSH_TARGET_MANAGEMENT_RUNTIME_CAPABILITY]
  },
  {
    wiring: 'runtime.setAgentBrowserBridge',
    missingOn: 'helixd',
    reason: 'helixd installs browser automation through the runtime factory when Chromium exists.'
  },
  {
    wiring: 'runtime.setOffscreenBrowserBackend',
    missingOn: 'helixd',
    reason: 'Offscreen WebContents need Electron.'
  },
  {
    wiring: 'ctor:prepareClaudeAuth',
    missingOn: 'helixd',
    reason: 'helixd passes it to registerHeadlessPtyRuntime instead, and only off WSL.'
  },
  {
    wiring: 'ctor:onPtyStopped',
    missingOn: 'helixd',
    reason: 'It clears renderer-side provider state, and helixd has no renderer.'
  },
  {
    wiring: 'ctor:onTerminalSideEffects',
    missingOn: 'helixd',
    reason: 'Side effects are delivered to a desktop window only.'
  },
  {
    wiring: 'ctor:attestAgentHookCompatibilityAuthority',
    missingOn: 'helixd',
    reason: 'Compatibility hook authority belongs to desktop-launched panes.'
  },
  {
    wiring: 'ctor:retireAgentHookCompatibilityAuthority',
    missingOn: 'helixd',
    reason: 'Pairs with attestAgentHookCompatibilityAuthority.'
  },
  {
    wiring: 'ctor:getPairedDeviceName',
    missingOn: 'helixd',
    reason: 'Unwired gap (follow-up): client-hosted browser rows show no paired-device name.'
  },
  {
    wiring: 'ctor:orchestrationEnvironmentTransport',
    missingOn: 'helixd',
    reason: 'Cross-environment orchestration dials paired environments from the desktop only.'
  },
  {
    wiring: 'ctor:skillTransactionRecovery',
    missingOn: 'helixd',
    reason:
      'No startup skill-transaction recovery runs on helixd, so installs need not wait for one.'
  },
  {
    wiring: 'ctor:workspaceSleepPlatform',
    missingOn: 'helixd',
    reason:
      'Sleep reaches paired servers and suspends VMs from the desktop only; helixd refuses those parts.'
  },
  {
    wiring: 'rpc-option:exposeNetworkByDefault',
    missingOn: 'helixd',
    reason: 'helixd pins its bind host instead, so exposure never widens itself.'
  },
  {
    wiring: 'rpc.setMobileDesktopRelayHosts',
    missingOn: 'helixd',
    reason: 'The mobile desktop relay is hosted by the desktop.'
  },
  {
    wiring: 'rpc.setOnUnpairedDeviceAuthFailure',
    missingOn: 'helixd',
    reason: 'It notifies a desktop window.'
  },
  {
    wiring: 'rpc-option:pinnedBindHost',
    missingOn: 'electron',
    reason: 'The desktop binds loopback until a device pairs (BIO-2370).'
  },
  {
    wiring: 'host:setMainHttpClient',
    missingOn: 'helixd',
    reason: "The port's default is Node's fetch; Chromium's network stack is desktop-only."
  },
  {
    wiring: 'host:setDefaultProxySessionResolver',
    missingOn: 'helixd',
    reason: 'It resolves a Chromium session; helixd reads proxy settings from the environment.'
  },
  {
    wiring: 'host:setRuntimeDesktopSurface',
    missingOn: 'helixd',
    reason: 'Desktop windows and notifications; helixd has none to surface.'
  },
  {
    wiring: 'host:setPtyHostBindings',
    missingOn: 'helixd',
    reason: "It binds Electron's ipcMain and powerMonitor; helixd serves PTYs over runtime RPC."
  },
  {
    wiring: 'host:setSpawnObserver',
    missingOn: 'helixd',
    reason: 'Desktop subprocess-spawn diagnostics only.'
  },
  {
    wiring: 'host:setWorktreeWatcherRemoval',
    missingOn: 'helixd',
    reason: 'It closes renderer-side worktree watchers; helixd has no renderer.'
  },
  {
    wiring: 'host:setBrowserHostClientProfileResolver',
    missingOn: 'helixd',
    reason: 'Browser profiles live in Chromium sessions; helixd pages carry profile ids only.'
  },
  {
    wiring: 'host:setManagedBrowserProfileDeleter',
    missingOn: 'helixd',
    reason: 'Managed profiles live in Chromium sessions; helixd has none to delete on removal.'
  },
  {
    wiring: 'host:setDesktopBrowserBridgeHostEnabled',
    missingOn: 'electron',
    reason: 'The desktop hosts browser pages itself; helixd enables the bridge to a desktop.'
  }
]

const UNWIRED_CONSTRUCTION_OPTIONS: Readonly<Record<string, string>> = {}

const POSITIONAL_CONSTRUCTOR_PARAMETERS = ['stats'] as const

const ROOT_SOURCES: Record<Root, readonly string[]> = {
  electron: [
    'src/main/startup/main-process-runtime-service.ts',
    'src/main/startup/main-process-ready-runtime.ts',
    'src/main/startup/main-process-runtime-launch.ts',
    'src/main/window/attach-main-window-services.ts'
  ],
  helixd: ['src/main/helixd/helixd-entry.ts', 'src/main/helixd/helixd-account-services.ts']
}

const HOST_PORT_SOURCES: Record<Root, readonly string[]> = {
  electron: [
    'src/main/startup/main-process-preflight.ts',
    'src/main/host/electron-browser-commands.ts'
  ],
  helixd: [
    'src/main/helixd/helixd-host-adapters.ts',
    'src/main/helixd/helixd-lifecycle.ts',
    'src/main/helixd/helixd-browser-startup.ts'
  ]
}

const NOT_HOST_PORTS = new Set(['setTimeout', 'setInterval', 'setImmediate'])

const SPREAD_SOURCES: Record<string, { file: string; anchor: string }> = {
  'agentHookRuntimeDeps(': {
    file: 'src/main/agent-hooks/agent-hook-runtime-deps.ts',
    anchor: 'return {'
  },
  codexStructuredLaunchHomeResolvers: {
    file: 'src/main/startup/codex-launch-preparation.ts',
    anchor: 'codexStructuredLaunchHomeResolvers = {'
  },
  'accountLaunch?.runtimeDeps': {
    file: 'src/main/helixd/helixd-account-services.ts',
    anchor: 'runtimeDeps: {'
  },
  'helixdWsPortOptions(': {
    file: 'src/main/helixd/helixd-ws-port-policy.ts',
    anchor: 'wsPort: port'
  }
}

const repoRoot = join(__dirname, '../../../..')
const read = (file: string): string => stripComments(readFileSync(join(repoRoot, file), 'utf8'))

const QUOTES = `'"\``

function stringEnd(source: string, open: number): number {
  for (let i = open + 1; i < source.length; i++) {
    if (source[i] === '\\') {
      i++
    } else if (source[i] === source[open]) {
      return i
    }
  }
  return source.length
}

function stripComments(source: string): string {
  let out = ''
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (QUOTES.includes(char)) {
      const end = stringEnd(source, i)
      out += source.slice(i, end + 1)
      i = end
    } else if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') {
        i++
      }
      out += '\n'
    } else if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 1
    } else {
      out += char
    }
  }
  return out
}

function braceGroup(source: string, open: number): string {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const char = source[i]
    if (QUOTES.includes(char)) {
      i = stringEnd(source, i)
    } else if (char === '{') {
      depth++
    } else if (char === '}' && --depth === 0) {
      return source.slice(open + 1, i)
    }
  }
  throw new Error('unbalanced braces')
}

function parenGroup(source: string, open: number): string {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const char = source[i]
    if (QUOTES.includes(char)) {
      i = stringEnd(source, i)
    } else if (char === '(') {
      depth++
    } else if (char === ')' && --depth === 0) {
      return source.slice(open + 1, i)
    }
  }
  throw new Error('unbalanced parentheses')
}

// A matching type shape precedes the value; use the final match.
function objectLiteralAfter(source: string, anchor: string): string {
  const at = source.lastIndexOf(anchor)
  if (at === -1) {
    throw new Error(`anchor not found: ${anchor}`)
  }
  const anchorOpen = anchor.lastIndexOf('{')
  const open = anchorOpen !== -1 ? at + anchorOpen : source.lastIndexOf('{', at)
  return braceGroup(source, open)
}

function topLevelEntries(inner: string): string[] {
  const entries: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i]
    if (QUOTES.includes(char)) {
      i = stringEnd(inner, i)
    } else if ('({['.includes(char)) {
      depth++
    } else if (')}]'.includes(char)) {
      depth--
    } else if (char === ',' && depth === 0) {
      entries.push(inner.slice(start, i).trim())
      start = i + 1
    }
  }
  entries.push(inner.slice(start).trim())
  return entries.filter(Boolean)
}

function objectKeys(inner: string): string[] {
  const keys: string[] = []
  for (const entry of topLevelEntries(inner)) {
    if (!entry.startsWith('...')) {
      const key = /^(?:async\s+)?([A-Za-z_$][\w$]*)/.exec(entry)?.[1]
      if (!key) {
        throw new Error(`unparsed object entry: ${entry}`)
      }
      keys.push(key)
      continue
    }
    const spread = entry.slice(3).trim()
    const source = Object.entries(SPREAD_SOURCES).find(([prefix]) => spread.startsWith(prefix))
    if (source) {
      keys.push(...objectKeys(objectLiteralAfter(read(source[1].file), source[1].anchor)))
      continue
    }
    let found = false
    for (let i = spread.indexOf('{'); i !== -1; i = spread.indexOf('{', i + 1)) {
      const group = braceGroup(spread, i)
      keys.push(...objectKeys(group))
      i += group.length + 1
      found = true
    }
    if (!found) {
      throw new Error(`teach SPREAD_SOURCES where this spread comes from: ${spread}`)
    }
  }
  return keys
}

function recordWiring(root: Root): Set<string> {
  const wired = new Set<string>()
  for (const file of ROOT_SOURCES[root]) {
    const source = read(file)
    if (source.includes('new HelixRuntimeService(')) {
      const call = source.indexOf('new HelixRuntimeService(')
      const [, ...positional] = topLevelEntries(parenGroup(source, source.indexOf('(', call)))
      const options = positional.pop() ?? ''
      positional.forEach((argument, index) => {
        if (argument !== 'undefined' && argument !== 'null') {
          wired.add(`ctor-arg:${POSITIONAL_CONSTRUCTOR_PARAMETERS[index] ?? index}`)
        }
      })
      for (const key of objectKeys(braceGroup(options, options.indexOf('{')))) {
        wired.add(`ctor:${key}`)
      }
    }
    if (source.includes('new HelixRuntimeRpcServer(')) {
      for (const key of objectKeys(objectLiteralAfter(source, 'new HelixRuntimeRpcServer({'))) {
        wired.add(`rpc-option:${key}`)
      }
    }
    for (const [, receiver, setter] of source.matchAll(
      /\b(runtime|runtimeRpc|rpc)\.(set[A-Z]\w*)\(/g
    )) {
      wired.add(`${receiver === 'runtime' ? 'runtime' : 'rpc'}.${setter}`)
    }
    if (/\bregister(?:HeadlessServe)?SshHandlers\(/.test(source)) {
      wired.add('registerSshHandlers')
    }
  }
  for (const file of HOST_PORT_SOURCES[root]) {
    for (const setter of hostPortCalls(read(file))) {
      wired.add(`host:${setter}`)
    }
  }
  return wired
}

/** Teardown resets (null/undefined/false) do not install host ports. */
function hostPortCalls(source: string): string[] {
  const installs: string[] = []
  for (const match of source.matchAll(/(?<![\w$.])(?<!function\s+)(set[A-Z]\w*)\(/g)) {
    const setter = match[1]
    const argument = parenGroup(source, match.index + setter.length).trim()
    if (!NOT_HOST_PORTS.has(setter) && !['null', 'undefined', 'false'].includes(argument)) {
      installs.push(setter)
    }
  }
  return installs
}

function sourceFilesUnder(dir: string): string[] {
  return readdirSync(join(repoRoot, dir), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !/\.(test|spec)\.ts$|fixture/.test(file))
    .map((file) => join(dir, file).split(sep).join('/'))
}

function declaredConstructionOptions(): string[] {
  const source = read('src/main/runtime/construction/runtime-construction-dependencies.ts')
  const inner = objectLiteralAfter(source, 'export type RuntimeConstructionDependencies = {')
  return [...inner.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\??:/gm)].map(([, key]) => key)
}

function declaredPositionalParameters(): string[] {
  const source = read('src/main/runtime/construction/runtime-construction.ts')
  const params = topLevelEntries(parenGroup(source, source.indexOf('constructor(') + 11))
  return params.slice(1, -1).map((param) => /^([A-Za-z_$][\w$]*)/.exec(param)?.[1] ?? param)
}

describe('runtime composition parity (Electron vs helixd)', () => {
  const electron = recordWiring('electron')
  const helixd = recordWiring('helixd')

  it('records the wiring both roots share', () => {
    for (const shared of [
      'ctor:getLocalProvider',
      'ctor:onTerminalAgentStatus',
      'ctor:agentSessionClaimSigner',
      'rpc-option:webClientRoot',
      'rpc-option:wsPort',
      'runtime.setAccountServices',
      // without it `stats.summary` answers {} and mobile home shows zeros.
      'ctor-arg:stats',
      'host:setAppEnvironment',
      'host:setSecretStore',
      'host:setRuntimeBrowserCommandsFactory',
      // without it every speech call refuses with speech_unavailable.
      'host:setSpeechServiceFactories'
    ]) {
      expect(electron, shared).toContain(shared)
      expect(helixd, shared).toContain(shared)
    }
  })

  it('declares every wiring one root skips, and nothing it does not skip', () => {
    const actual = [
      ...[...electron].filter((w) => !helixd.has(w)).map((w) => `helixd lacks ${w}`),
      ...[...helixd].filter((w) => !electron.has(w)).map((w) => `electron lacks ${w}`)
    ].sort()
    const declared = DECLARED_HOST_DIFFERENCES.map((d) => `${d.missingOn} lacks ${d.wiring}`)
    expect(actual).toEqual([...declared].sort())
  })

  it('accounts for every way the runtime takes a host service', () => {
    expect(declaredPositionalParameters()).toEqual([...POSITIONAL_CONSTRUCTOR_PARAMETERS])
    const wiredAnywhere = new Set([...electron, ...helixd])
    const unaccounted = declaredConstructionOptions().filter(
      (key) => !wiredAnywhere.has(`ctor:${key}`) && !(key in UNWIRED_CONSTRUCTION_OPTIONS)
    )
    expect(
      unaccounted,
      'wire these on a root or list them in UNWIRED_CONSTRUCTION_OPTIONS'
    ).toEqual([])
  })

  it('finds every host-port install in the files it reads', () => {
    const known = new Set(
      [...electron, ...helixd].filter((w) => w.startsWith('host:')).map((w) => w.slice(5))
    )
    const listed = new Set(Object.values(HOST_PORT_SOURCES).flat())
    const unlisted = ['src/main/startup', 'src/main/helixd']
      .flatMap(sourceFilesUnder)
      .filter((file) => !listed.has(file) && hostPortCalls(read(file)).some((s) => known.has(s)))
    expect(unlisted, 'add these files to HOST_PORT_SOURCES').toEqual([])
  })

  // helixd once installed a browser factory that could not place pages on a desktop.
  it('wires the browser factory and client-hosting options on both roots', () => {
    const installs: Record<Root, { root: string; call: string; file: string; option: RegExp }> = {
      electron: {
        root: 'src/main/startup/main-process-preflight.ts',
        call: 'installElectronBrowserCommands(',
        file: 'src/main/host/electron-browser-commands.ts',
        option: /\bclientHosting: true\b/
      },
      helixd: {
        root: 'src/main/helixd/helixd-lifecycle.ts',
        call: 'startHelixdBrowserProvider(',
        file: 'src/main/helixd/helixd-browser-startup.ts',
        option: /\bclientHostingWithoutEngine: true\b/
      }
    }
    for (const [root, install] of Object.entries(installs)) {
      expect(read(install.root), root).toContain(install.call)
      expect(read(install.file), root).toMatch(install.option)
    }
  })

  it('lists each advertised-but-unserved capability against what the host advertises', () => {
    for (const difference of DECLARED_HOST_DIFFERENCES) {
      expect(difference.reason, difference.wiring).not.toBe('')
      for (const capability of difference.advertisedUnserved ?? []) {
        expect(new Set<string>(RUNTIME_CAPABILITIES), difference.wiring).toContain(capability)
      }
    }
  })
})
