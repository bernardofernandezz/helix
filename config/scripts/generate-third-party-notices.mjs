#!/usr/bin/env node
// Bundles license texts of production dependencies; MIT/BSD/Apache require them on redistribution.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = 'out/THIRD_PARTY_NOTICES.txt'
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i

const byLicense = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32'
  })
)

const sections = []
for (const [license, packages] of Object.entries(byLicense)) {
  for (const pkg of packages) {
    const dir = pkg.paths[0]
    const texts = readdirSync(dir)
      .filter((name) => LICENSE_FILE.test(name))
      .sort()
      .map((name) => readFileSync(join(dir, name), 'utf8').trim())
    sections.push(
      `${pkg.name}@${pkg.versions.join(', ')} (${license})\n${pkg.homepage ?? ''}\n\n${texts.join('\n\n') || '(no license file shipped by the package)'}`
    )
  }
}
sections.sort()

mkdirSync('out', { recursive: true })
writeFileSync(
  OUT,
  `Helix bundles the following third-party software.\n\n${sections.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`
)
console.log(`Wrote ${sections.length} notices to ${OUT}`)
