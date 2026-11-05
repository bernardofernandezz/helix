'use client'

import { Download } from 'lucide-react'
import { useSyncExternalStore, type ReactNode } from 'react'
import { LINUX_DOWNLOAD_URL, RELEASES_URL, WINDOWS_DOWNLOAD_URL } from '@/lib/helix-links'

type Platform = 'windows' | 'linux' | 'other'

function detectPlatform(): Platform {
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) {
    return 'windows'
  }
  // Android reports Linux too; it gets the generic releases link.
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) {
    return 'linux'
  }
  return 'other'
}

const noopSubscribe = () => () => {}

const BUTTON = {
  windows: { label: 'Download for Windows', href: WINDOWS_DOWNLOAD_URL },
  linux: { label: 'Download for Linux', href: LINUX_DOWNLOAD_URL },
  other: { label: 'Download the beta', href: RELEASES_URL }
}

const altLink =
  'rounded-sm underline decoration-border underline-offset-4 transition-colors hover:text-foreground'

export function DownloadButton({ secondary }: { secondary: ReactNode }) {
  // SSR renders the generic link; the platform label swaps in on hydration.
  const platform = useSyncExternalStore(noopSubscribe, detectPlatform, () => 'other' as const)
  const { label, href } = BUTTON[platform]

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-3">
        <a
          href={href}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-[15px] font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          <Download className="size-4" aria-hidden="true" />
          {label}
        </a>
        {secondary}
      </div>
      <p className="text-xs text-muted-foreground">
        {platform === 'windows' ? (
          <a href={LINUX_DOWNLOAD_URL} className={altLink}>
            Also for Linux
          </a>
        ) : platform === 'linux' ? (
          <a href={WINDOWS_DOWNLOAD_URL} className={altLink}>
            Also for Windows
          </a>
        ) : (
          <>
            <a href={WINDOWS_DOWNLOAD_URL} className={altLink}>
              Windows
            </a>
            {' · '}
            <a href={LINUX_DOWNLOAD_URL} className={altLink}>
              Linux
            </a>
          </>
        )}
        {' · macOS coming soon'}
      </p>
    </div>
  )
}
