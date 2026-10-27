// Change only template build identity to model an app update bundling a newer helixd.
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  HELIXD_TEMPLATE_MANIFEST_FILENAME,
  HELIXD_VERSION
} from '../../../src/shared/helixd-artifacts'

const ENTRY = 'helixd.js'

/** Rewrites `templateDir` in place; its manifest keeps verifying. */
export function makeHelixdTemplateVariant(templateDir: string, tag: string): void {
  const entry = path.join(templateDir, ENTRY)
  appendFileSync(entry, `\n// helixd e2e template variant ${tag}\n`)
  const manifestPath = path.join(templateDir, HELIXD_TEMPLATE_MANIFEST_FILENAME)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.commonSha256[ENTRY] = createHash('sha256').update(readFileSync(entry)).digest('hex')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

/** The host's activation record, read the way a client reads it. */
export function readHostHelixdActivation(exec: (command: string) => string): {
  active?: string
  previous?: string
  activeAppVersion?: string
} {
  return JSON.parse(exec('cat "$HOME/.helix-remote/helixd-active.json"'))
}

export function isHelixdFullVersion(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(`${HELIXD_VERSION}+`)
}
