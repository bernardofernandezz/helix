# Helix design language

How Helix looks and speaks. Token values live in `src/renderer/src/assets/main.css`; the docs site and
landing page mirror them in `docs/site/src/app/globals.css`. This file explains the intent so new
surfaces stay on-brand.

## Idea

Helix is a lab instrument for agents: precise, calm, a little futuristic. Think of a dark bench under a
single cold light: ink surfaces, glass-tinted neutrals, and one living color that marks what matters.
The interface frames the science (data, sequences, plots, agent output) and never competes with it.

## Two strands

The double helix is the organizing image. Two strands, never more:

| Strand          | Color                                           | Carries                                                                       |
| --------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| **Signal** teal | `primary`, `ring`, `sidebar-primary`, `chart-*` | The one affirmative action, focus, selection, brand marks, plotted data       |
| **Data** amber  | `annotation-highlight`, `agent-question`        | Highlights inside content: annotations, flagged values, questions to the user |

Everything else is the **base**: neutrals with a slight cool tint (`background`, `card`, `muted`,
`accent`, `border`). State colors (agent working/question, git decorations, destructive, diff) keep their
meaning and are not brand colors; never recolor them to teal.

Rules:

- Teal appears once per region. A screen with three teal buttons has no primary action.
- Never put teal text on teal tints for body copy; teal is for controls, marks and data, not paragraphs.
- Dark mode is the reference look (ink `#080c0e`, signal `#46d6bc`); light mode keeps the same roles
  with deeper teal (`#0b6658`) so text on it passes 4.5:1.
- Plots use the `chart-*` teal ramp for sequential data. Categorical series may add amber as the
  second strand before reaching for other hues.

## Type

- UI: Geist (sans), dense and neutral. Literal things (paths, accessions, sequences, commands, IDs) are
  always mono: `P04637`, `ENSG00000141510`, `rs699`, `chr17:7,661,779`.
- Scientific notation is real typography: italic gene symbols where the content defines them (_TP53_),
  proper units (`µL`, `°C`, `Å`), true minus signs and superscripts in rendered content.
- Category labels: 11px, semibold, uppercase, 0.05em tracking. Use them like instrument panel labels:
  short nouns (`SEQUENCE`, `RUN`, `CLUSTER`), never sentences.

## Motifs

Use sparingly; one motif per surface.

- **Base-pair rule**: a hairline divider made of short paired ticks, for section breaks on empty states,
  onboarding and the landing page. Never inside dense lists.
- **Readout**: mono uppercase key/value pairs (`PLDDT 87.4 · RES 2.2 Å · 2026-10-27`) for metadata
  under a title, like an instrument display.
- **Grid field**: a faint 24px grid behind empty states and hero areas, `border` color at low opacity.
- **Glow**: in dark mode only, focus and the live agent indicator may carry a soft teal glow
  (`0 0 0 1px ring, 0 0 12px ring/30%`). No other glows, no gradients on surfaces.

## Voice

Write for scientists, not developers:

- Say what the system did with evidence: "Found 11 papers (PubMed, retrieved 14:56)", not "Searching
  the world's knowledge…".
- Prefer research nouns: project, analysis, run, sample, dataset, cluster, job. Keep developer terms
  (worktree, branch) where they are literally git.
- Cite. Accessions and PMIDs are links; database answers show source and retrieval time.
- No hype, no "magic", no emoji in product copy.

## Docs and landing page

Same tokens, same two strands, dark first. The landing hero uses the grid field and the helix mark; feature
sections use readouts for proof points (databases supported, pipeline engines, clusters) instead of
marketing adjectives.
