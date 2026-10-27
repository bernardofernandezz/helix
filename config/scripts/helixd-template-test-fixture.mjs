import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  HELIXD_MOBILE_WEB_MANIFEST,
  HELIXD_NODE_RUNTIME_MARKER_FILENAME,
  HELIXD_SERVER_TARGET_FILENAME,
  HELIXD_TEMPLATE_MANIFEST_FILENAME,
  HELIXD_TEMPLATE_TARGETS_DIR,
  helixdTemplateCommonFilenames,
  helixdTemplateTargetFilenames
} from '../../src/shared/helixd-artifacts.ts'
import {
  COMPAT_SERVER_TARGETS,
  HELIXD_TEMPLATE_TARGETS,
  pinnedNodeRuntimeAsset
} from '../../src/shared/node-runtime-pin.ts'

async function write(path, contents) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
  return createHash('sha256').update(contents).digest('hex')
}

function targetFileContents(target, filename) {
  if (filename === HELIXD_SERVER_TARGET_FILENAME) {
    return `${target}\n`
  }
  if (filename === HELIXD_NODE_RUNTIME_MARKER_FILENAME) {
    return `${pinnedNodeRuntimeAsset(target).executableSha256}\n`
  }
  return `${target}:${filename}`
}

export async function writeHelixdTemplateTestFixture(resourcesDir, { compat = false } = {}) {
  const templateDir = join(resourcesDir, 'helixd-template')
  const commonSha256 = {}
  for (const filename of helixdTemplateCommonFilenames(['out/mobile-web/index.html'])) {
    commonSha256[filename] = await write(
      join(templateDir, ...filename.split('/')),
      Buffer.from(
        filename === HELIXD_MOBILE_WEB_MANIFEST
          ? JSON.stringify({ assets: [{ path: 'index.html' }] })
          : `common:${filename}`
      )
    )
  }
  const targets = {}
  for (const target of [...HELIXD_TEMPLATE_TARGETS, ...(compat ? COMPAT_SERVER_TARGETS : [])]) {
    const targetDir = join(templateDir, HELIXD_TEMPLATE_TARGETS_DIR, target)
    const files = {}
    for (const filename of helixdTemplateTargetFilenames(target)) {
      files[filename] = await write(
        join(targetDir, ...filename.split('/')),
        targetFileContents(target, filename)
      )
    }
    targets[target] = { files }
  }
  const browserName = 'agent-browser-linux-x64'
  targets['linux-x64-glibc'] = {
    ...targets['linux-x64-glibc'],
    browserName,
    browserSha256: await write(
      join(templateDir, HELIXD_TEMPLATE_TARGETS_DIR, 'linux-x64-glibc', browserName),
      'browser'
    )
  }
  await writeFile(
    join(templateDir, HELIXD_TEMPLATE_MANIFEST_FILENAME),
    JSON.stringify({ schemaVersion: 3, commonSha256, targets })
  )
  return templateDir
}
