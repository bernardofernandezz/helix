import Link from 'next/link'
import { HelixMark } from '@/components/landing/HelixMark'
import {
  ISSUES_URL,
  LATEST_RELEASE_URL,
  LICENSE_URL,
  RELEASES_URL,
  REPO_URL
} from '@/lib/helix-links'

const currentYear = new Date().getFullYear()

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Download', href: LATEST_RELEASE_URL },
      { label: 'Docs', href: '/docs' },
      { label: 'Changelog', href: RELEASES_URL }
    ]
  },
  {
    title: 'Community',
    links: [
      { label: 'GitHub', href: REPO_URL },
      { label: 'Report an issue', href: ISSUES_URL }
    ]
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', href: '/docs/telemetry' },
      { label: 'MIT License', href: LICENSE_URL }
    ]
  }
]

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="flex flex-col gap-3">
          <Link
            href="/"
            className="flex w-fit items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <HelixMark className="size-6 text-foreground" />
            <span className="text-[15px] font-semibold tracking-tight">Helix</span>
          </Link>
          <p className="max-w-xs text-sm text-muted-foreground">
            The agentic research environment for the life sciences. Free and open source.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title} className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">{column.title}</h2>
            {column.links.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="w-fit text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
      <div className="mx-auto flex max-w-[1200px] flex-col gap-2 border-t border-border px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:justify-between">
        <span>© {currentYear} Helix contributors</span>
        <span>Closed beta · Windows and Linux</span>
      </div>
    </footer>
  )
}
