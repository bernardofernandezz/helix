import Link from 'next/link'
import { Download } from 'lucide-react'
import { GithubMark } from './GithubMark'
import { HelixMark } from '@/components/landing/HelixMark'
import { LATEST_RELEASE_URL, RELEASES_URL, REPO_URL } from '@/lib/helix-links'

async function getGithubStars(): Promise<number | undefined> {
  try {
    const response = await fetch('https://api.github.com/repos/bernardofernandezz/helix', {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: 3600 }
    })
    if (!response.ok) {
      return undefined
    }
    const payload = (await response.json()) as { stargazers_count?: unknown }
    return typeof payload.stargazers_count === 'number' ? payload.stargazers_count : undefined
  } catch {
    return undefined
  }
}

function formatStars(stars: number): string {
  return stars >= 1000 ? `${(stars / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(stars)
}

const navLink =
  'rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

export async function SiteHeader() {
  const stars = await getGithubStars()

  return (
    <header className="fixed inset-x-0 top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-4 sm:gap-6">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <HelixMark className="size-6 text-foreground" />
            <span className="text-[15px] font-semibold tracking-tight">Helix</span>
          </Link>
          <nav aria-label="Primary" className="flex items-center">
            <Link href="/docs" className={navLink}>
              Docs
            </Link>
            <Link href="/docs/research-tools" className={`${navLink} hidden sm:inline`}>
              Research tools
            </Link>
            <a href={RELEASES_URL} className={`${navLink} hidden sm:inline`}>
              Changelog
            </a>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={REPO_URL}
            aria-label={stars === undefined ? 'GitHub' : `GitHub, ${stars} stars`}
            className={`${navLink} inline-flex items-center gap-1.5`}
          >
            <GithubMark className="size-4" />
            {stars !== undefined && <span className="tabular-nums">{formatStars(stars)}</span>}
          </a>
          <a
            href={LATEST_RELEASE_URL}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download className="size-4" aria-hidden="true" />
            Download
          </a>
        </div>
      </div>
    </header>
  )
}
