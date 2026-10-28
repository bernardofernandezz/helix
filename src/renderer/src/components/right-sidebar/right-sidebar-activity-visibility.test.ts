import { describe, expect, it } from 'vitest'
import { Files } from 'lucide-react'
import type { ActivityBarItem } from './activity-bar-buttons'
import { getVisibleRightSidebarActivityItems } from './right-sidebar-activity-visibility'

const items: ActivityBarItem[] = [
  { id: 'explorer', icon: Files, title: 'Explorer', shortcut: '' },
  {
    id: 'workspaces',
    icon: Files,
    title: 'Workspaces',
    shortcut: '',
    folderOnly: true
  },
  {
    id: 'pr-checks',
    icon: Files,
    title: 'PR Checks',
    shortcut: '',
    folderOnly: true
  },
  {
    id: 'source-control',
    icon: Files,
    title: 'Source Control',
    shortcut: '',
    gitOnly: true
  },
  { id: 'ports', icon: Files, title: 'Ports', shortcut: '', sshOnly: true },
  {
    id: 'checks',
    icon: Files,
    title: 'Checks',
    shortcut: '',
    gitOnly: true,
    advancedOnly: true
  },
  // Plugin panels carry no visibility flags, so they show in every context.
  {
    id: 'plugin:helix-samples.my-plugin/dashboard',
    icon: Files,
    title: 'Dashboard',
    shortcut: ''
  }
]

describe('getVisibleRightSidebarActivityItems', () => {
  it('shows ports only for workspaces on an SSH host', () => {
    expect(
      getVisibleRightSidebarActivityItems(items, {
        isFolder: false,
        isFolderWorkspace: false,
        hasSshHost: false,
        advancedMode: true
      }).map((item) => item.id)
    ).toEqual(['explorer', 'source-control', 'checks', 'plugin:helix-samples.my-plugin/dashboard'])

    expect(
      getVisibleRightSidebarActivityItems(items, {
        isFolder: false,
        isFolderWorkspace: false,
        hasSshHost: true,
        advancedMode: true
      }).map((item) => item.id)
    ).toEqual([
      'explorer',
      'source-control',
      'ports',
      'checks',
      'plugin:helix-samples.my-plugin/dashboard'
    ])
  })

  it('shows Workspaces only for folder workspaces and hides git tabs for all folder scopes', () => {
    expect(
      getVisibleRightSidebarActivityItems(items, {
        isFolder: true,
        isFolderWorkspace: true,
        hasSshHost: true,
        advancedMode: true
      }).map((item) => item.id)
    ).toEqual([
      'explorer',
      'workspaces',
      'pr-checks',
      'ports',
      'plugin:helix-samples.my-plugin/dashboard'
    ])

    expect(
      getVisibleRightSidebarActivityItems(items, {
        isFolder: true,
        isFolderWorkspace: false,
        hasSshHost: true,
        advancedMode: true
      }).map((item) => item.id)
    ).toEqual(['explorer', 'ports', 'plugin:helix-samples.my-plugin/dashboard'])
  })

  it('hides developer tabs until Advanced mode is on', () => {
    expect(
      getVisibleRightSidebarActivityItems(items, {
        isFolder: false,
        isFolderWorkspace: false,
        hasSshHost: true,
        advancedMode: false
      }).map((item) => item.id)
    ).toEqual(['explorer', 'source-control', 'ports', 'plugin:helix-samples.my-plugin/dashboard'])
  })
})
