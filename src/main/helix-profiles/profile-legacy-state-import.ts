import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  getHelixProfileBrowserSessionMetaFile,
  getHelixProfileDataFile,
  LEGACY_BACKUP_COUNT,
  legacyBackupPath,
  legacyBrowserSessionMetaPath,
  legacyDataFilePath,
  profileBackupPath
} from './profile-storage-paths'

function copyIfPresent(source: string, target: string): void {
  if (!existsSync(source) || existsSync(target)) {
    return
  }
  mkdirSync(dirname(target), { recursive: true })
  // Publish atomically: partial copies must not pass the completed-migration existence check.
  const tmpTarget = `${target}.tmp`
  copyFileSync(source, tmpTarget)
  renameSync(tmpTarget, target)
}

export function copyLegacyStateToProfile(userDataPath: string, profileId: string): void {
  const profileDataFile = getHelixProfileDataFile(profileId, userDataPath)
  copyIfPresent(legacyDataFilePath(userDataPath), profileDataFile)
  copyIfPresent(
    legacyBrowserSessionMetaPath(userDataPath),
    getHelixProfileBrowserSessionMetaFile(profileId, userDataPath)
  )
  for (let i = 0; i < LEGACY_BACKUP_COUNT; i++) {
    copyIfPresent(legacyBackupPath(userDataPath, i), profileBackupPath(profileDataFile, i))
  }
}
