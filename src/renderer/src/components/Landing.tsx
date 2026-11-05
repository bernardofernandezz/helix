import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink, FolderPlus, MessageSquarePlus, Star, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { useAppStore } from '../store'
import type { Repo } from '../../../shared/repo-types'
import {
  dismissPreflightIssue,
  githubProjectKeys,
  isPreflightIssueDismissed
} from './landing-preflight-dismissal'
import { useMountedRef } from '@/hooks/useMountedRef'
import logo from '../../../../resources/logo.svg'
import { translate } from '@/i18n/i18n'
import { hasGitHubBackedProject, type PreflightIssue } from './landing-preflight-issues'
import { useLandingPreflightRuntime } from './landing-preflight-runtime'
import { useLandingHelixStarState, type LandingStarState } from './landing-github-star-state'

// Do not deep-link to /stargazers: GitHub 404s that page for users without repo write access.
const HELIX_GITHUB_URL = 'https://github.com/bernardofernandezz/helix'

type StarButtonProps = {
  hasRepos: boolean
  state: LandingStarState
  setState: React.Dispatch<React.SetStateAction<LandingStarState>>
}

function GitHubStarButton({
  hasRepos,
  state,
  setState
}: StarButtonProps): React.JSX.Element | null {
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const mountedRef = useMountedRef()

  useEffect(() => {
    if (!menuOpen) {
      return
    }
    const onDocClick = (e: MouseEvent): void => {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  const handleClick = async (): Promise<void> => {
    if (state === 'starred') {
      setMenuOpen((v) => !v)
      return
    }
    if (state === 'web-fallback') {
      await window.api.shell.openUrl(HELIX_GITHUB_URL)
      return
    }
    if (state !== 'not-starred') {
      return
    }
    setState('starred')
    const ok = await window.api.gh.starHelix('landing')
    if (!ok) {
      if (mountedRef.current) {
        setState('web-fallback')
      }
      return
    }
    // Starring anywhere must complete the nag so later thresholds cannot prompt again.
    await window.api.starNag.complete()
  }

  if (state === 'hidden' || (state === 'starred' && hasRepos)) {
    return null
  }

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        className={cn(
          'inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[13px] font-medium transition-all duration-300',
          state === 'loading' && 'pointer-events-none opacity-0',
          state !== 'starred' &&
            'cursor-pointer border-amber-500/60 text-amber-700 hover:border-amber-500/80 hover:bg-amber-400/10 dark:border-amber-400/30 dark:text-amber-300/90 dark:hover:border-amber-400/50 dark:hover:bg-amber-400/[0.08]',
          state === 'starred' &&
            'cursor-pointer border-amber-500/50 bg-amber-400/10 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/[0.06] dark:text-amber-400/60'
        )}
        onClick={handleClick}
        onContextMenu={(event) => {
          if (state === 'starred') {
            event.preventDefault()
            setMenuOpen(true)
          }
        }}
        disabled={state === 'loading'}
      >
        {state === 'web-fallback' ? (
          <ExternalLink className="size-3.5 text-amber-600 transition-all duration-300 dark:text-amber-400/80" />
        ) : (
          <Star
            className={cn(
              'size-3.5 transition-all duration-300',
              state === 'starred'
                ? 'fill-amber-500/70 text-amber-500/70 dark:fill-amber-400/60 dark:text-amber-400/60'
                : 'text-amber-600 dark:text-amber-400/80'
            )}
          />
        )}
        {state === 'starred'
          ? translate('auto.components.Landing.ec43b38ba7', 'Starred on GitHub')
          : state === 'web-fallback'
            ? translate('auto.components.Landing.157bb5ecbb', 'Open GitHub')
            : translate('auto.components.Landing.0d0ace8861', 'Star on GitHub')}
      </button>
      {state === 'starred' && menuOpen && (
        <div className="absolute right-0 bottom-[calc(100%+4px)] z-10 min-w-[100px] rounded-md border border-border bg-popover py-1 shadow-floating">
          <button
            className="w-full px-3 py-1.5 text-left text-[13px] text-foreground hover:bg-muted"
            onClick={() => {
              setMenuOpen(false)
              setState('hidden')
            }}
          >
            {translate('auto.components.Landing.c1cf168479', 'Hide')}
          </button>
        </div>
      )}
    </div>
  )
}

function dismissedPreflightIssueIds(issues: PreflightIssue[], repos: readonly Repo[]): Set<string> {
  return new Set(
    issues
      .filter((issue) => issue.dismissible && isPreflightIssueDismissed(issue.id, repos))
      .map((issue) => issue.id)
  )
}

function PreflightBanner({
  issues,
  repos
}: {
  issues: PreflightIssue[]
  repos: readonly Repo[]
}): React.JSX.Element | null {
  // Recheck dismissals when the GitHub project set changes so expired nudges can reappear.
  const githubKey = githubProjectKeys(repos).join('|')
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    dismissedPreflightIssueIds(issues, repos)
  )

  // Reseed only when GitHub projects change; issues identity is stable and would reset transient dismissals each render.
  const reseedDismissed = useEffectEvent(() =>
    setDismissed(dismissedPreflightIssueIds(issues, repos))
  )
  useEffect(() => {
    reseedDismissed()
  }, [githubKey])

  const visibleIssues = issues.filter((issue) => !dismissed.has(issue.id))
  if (visibleIssues.length === 0) {
    return null
  }

  const dismiss = (issue: PreflightIssue): void => {
    dismissPreflightIssue(issue.id, repos)
    setDismissed((prev) => new Set(prev).add(issue.id))
  }

  return (
    // Keep setup nudges narrow and muted; the styleguide reserves warning/error framing for actual problems.
    <div className="w-full max-w-sm space-y-1.5 rounded-lg border border-border bg-muted/40 p-3">
      {visibleIssues.map((issue) => (
        <div
          key={issue.id}
          className="flex items-start gap-3 rounded-md px-1 py-1.5 first:pt-0 last:pb-0"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500/70" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-[13px] font-medium leading-snug text-foreground">{issue.title}</p>
            <p className="text-xs leading-snug text-muted-foreground">{issue.description}</p>
            <button
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline cursor-pointer"
              onClick={() => window.api.shell.openUrl(issue.fixUrl)}
            >
              {issue.fixLabel}
              <ExternalLink className="size-3" />
            </button>
          </div>
          {issue.dismissible && (
            <button
              className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
              onClick={() => dismiss(issue)}
              aria-label={translate('auto.components.Landing.preflightDismiss', 'Dismiss')}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export default function Landing(): React.JSX.Element {
  const repos = useAppStore((s) => s.repos)
  const openModal = useAppStore((s) => s.openModal)

  const hasProjects = repos.length > 0
  const hasGitHubProject = useMemo(() => hasGitHubBackedProject(repos), [repos])
  const showGitHubSupportFooter = hasGitHubProject

  // Probe the active execution host, including remote runtimes.
  const { preflightIssues } = useLandingPreflightRuntime()
  const [starState, setStarState] = useLandingHelixStarState()

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background">
      <div className="w-full max-w-lg px-6">
        <div className="flex flex-col items-center gap-4 py-8">
          <div
            className="flex items-center justify-center size-20 rounded-2xl border border-border/80 shadow-lg shadow-black/40"
            style={{ backgroundColor: '#0F5C52' }}
          >
            <img
              src={logo}
              alt={translate('auto.components.Landing.520304a067', 'Helix logo')}
              className="size-12"
            />
          </div>
          <h1 className="text-4xl font-bold text-foreground tracking-tight">
            {translate('auto.components.Landing.6ca6ff404e', 'HELIX')}
          </h1>

          {preflightIssues.length > 0 && <PreflightBanner issues={preflightIssues} repos={repos} />}

          <p className="text-sm text-muted-foreground text-center">
            {hasProjects
              ? translate(
                  'auto.components.Landing.researchHasProjects',
                  'Pick a project in the sidebar or start a new chat about your data.'
                )
              : translate(
                  'auto.components.Landing.researchNoProjects',
                  'Create a research project or open a data folder, then chat with an agent about it.'
                )}
          </p>

          <div className="flex items-center justify-center gap-2.5 flex-wrap">
            <button
              className="inline-flex items-center gap-1.5 bg-secondary/70 border border-border/80 text-foreground font-medium text-sm px-4 py-2 rounded-md cursor-pointer hover:bg-accent transition-colors"
              onClick={() => openModal('add-repo')}
            >
              <FolderPlus className="size-3.5" />
              {translate('auto.components.Landing.f9eaa9e12d', 'Add project')}
            </button>

            {hasProjects && (
              <button
                className="inline-flex items-center gap-1.5 bg-secondary/70 border border-border/80 text-foreground font-medium text-sm px-4 py-2 rounded-md cursor-pointer hover:bg-accent transition-colors"
                onClick={() =>
                  openModal('new-workspace-composer', {
                    telemetrySource: 'unknown'
                  })
                }
              >
                <MessageSquarePlus className="size-3.5" />
                {translate('auto.components.Landing.newChat', 'New chat')}
              </button>
            )}
          </div>
        </div>
      </div>

      {showGitHubSupportFooter && (
        <div className="absolute bottom-6 left-0 right-0 flex justify-center">
          <GitHubStarButton hasRepos={repos.length > 0} state={starState} setState={setStarState} />
        </div>
      )}
    </div>
  )
}
