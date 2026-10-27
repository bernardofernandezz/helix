/** The double-helix mark: two strands in currentColor with signal-teal base pairs. */
export function HelixMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className={className} fill="none">
      <g stroke="var(--primary)" strokeWidth="5" strokeLinecap="round" opacity="0.85">
        <line x1="44" y1="20" x2="76" y2="20" />
        <line x1="47" y1="47" x2="73" y2="47" />
        <line x1="41" y1="60" x2="79" y2="60" />
        <line x1="47" y1="73" x2="73" y2="73" />
        <line x1="44" y1="100" x2="76" y2="100" />
      </g>
      <g stroke="currentColor" strokeWidth="9" strokeLinecap="round">
        <path d="M84 16 C84 36 36 36 36 60 C36 86 84 86 84 112" />
        <path d="M36 8 C36 34 84 34 84 60 C84 86 36 86 36 112" />
      </g>
      <circle cx="84" cy="11" r="8" fill="currentColor" />
    </svg>
  )
}

/** Base-pair rule: a hairline of paired ticks used as a section break. */
export function BasePairRule() {
  return <div aria-hidden="true" className="landing-base-pair-rule h-3 w-full" />
}
