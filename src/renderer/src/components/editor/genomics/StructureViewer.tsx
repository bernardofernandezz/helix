import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createViewer, type GLViewer } from '3dmol'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import { summarizeStructure } from './structure-format'

const REPRESENTATIONS = ['cartoon', 'sticks', 'surface'] as const
const COLORINGS = ['spectrum', 'chain', 'confidence'] as const
type Representation = (typeof REPRESENTATIONS)[number]
type Coloring = (typeof COLORINGS)[number]

const SEPARATOR = ' · '
const TOGGLE_ITEM_CLASS =
  'h-[23px] px-2 text-2xs data-[state=on]:border-foreground/20 data-[state=on]:bg-foreground/10 data-[state=on]:text-foreground'

function cartoonColor(coloring: Coloring): Record<string, unknown> {
  switch (coloring) {
    case 'spectrum':
      return { color: 'spectrum' }
    case 'chain':
      return { colorscheme: 'chain' }
    case 'confidence':
      // AlphaFold stores pLDDT in the B-factor column.
      return { colorscheme: { prop: 'b', gradient: 'roygb', min: 50, max: 90 } }
  }
}

function applyStyle(
  viewer: GLViewer,
  isMacromolecule: boolean,
  rep: Representation,
  coloring: Coloring
): void {
  viewer.removeAllSurfaces()
  if (!isMacromolecule) {
    viewer.setStyle({}, { stick: { radius: 0.18 }, sphere: { scale: 0.25 } })
    return
  }
  const color = cartoonColor(coloring)
  viewer.setStyle({}, rep === 'sticks' ? { stick: color } : { cartoon: color })
  viewer.setStyle({ hetflag: true, not: { resn: 'HOH' } }, { stick: {} })
  if (rep === 'surface') {
    // 3Dmol's SurfaceType.VDW; the enum is not exported from the package root.
    viewer.addSurface(1, { opacity: 0.85, ...color }, { hetflag: false })
  }
}

/** Read-only 3D view of PDB/mmCIF/SDF/MOL2/XYZ; Source mode keeps the raw text editable. */
export default function StructureViewer({
  content,
  format
}: {
  content: string
  format: string
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<GLViewer | null>(null)
  const isMacromolecule = format === 'pdb' || format === 'cif'
  const [representation, setRepresentation] = useState<Representation>('cartoon')
  const [coloring, setColoring] = useState<Coloring>('spectrum')
  const [error, setError] = useState<string | null>(null)
  const summary = useMemo(() => summarizeStructure(content, format), [content, format])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    try {
      const viewer = createViewer(container, { backgroundAlpha: 0 })
      viewer.addModels(content, format)
      viewerRef.current = viewer
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return
    }
    const resize = new ResizeObserver(() => viewerRef.current?.resize())
    resize.observe(container)
    return () => {
      resize.disconnect()
      viewerRef.current?.clear()
      viewerRef.current = null
      container.replaceChildren()
    }
  }, [content, format])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) {
      return
    }
    applyStyle(viewer, isMacromolecule, representation, coloring)
    viewer.zoomTo()
    viewer.render()
  }, [content, format, isMacromolecule, representation, coloring])

  const facts = [
    format.toUpperCase(),
    summary.atoms > 0
      ? translate('helix.structureViewer.atoms', '{{value}} atoms', {
          value: summary.atoms.toLocaleString()
        })
      : null,
    summary.chains.length > 0
      ? translate('helix.structureViewer.chains', 'chains {{value}}', {
          value: summary.chains.join(', ')
        })
      : null,
    summary.ligands.length > 0
      ? translate('helix.structureViewer.ligands', 'ligands {{value}}', {
          value: summary.ligands.slice(0, 6).join(', ')
        })
      : null,
    summary.molecules > 1
      ? translate('helix.structureViewer.molecules', '{{value}} molecules', {
          value: summary.molecules.toLocaleString()
        })
      : null
  ].filter((fact) => fact !== null)

  return (
    <div className="flex h-full min-h-0 flex-col bg-editor-surface text-foreground">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2 font-mono text-2xs tracking-wider">
        <span className="font-semibold uppercase">{facts.join(SEPARATOR)}</span>
        {isMacromolecule ? (
          <div className="ml-auto flex items-center gap-2">
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={representation}
              onValueChange={(value) =>
                setRepresentation((current) => REPRESENTATIONS.find((r) => r === value) ?? current)
              }
              aria-label={translate('helix.structureViewer.representation', 'Representation')}
            >
              <ToggleGroupItem value="cartoon" className={TOGGLE_ITEM_CLASS}>
                {translate('helix.structureViewer.cartoon', 'Cartoon')}
              </ToggleGroupItem>
              <ToggleGroupItem value="sticks" className={TOGGLE_ITEM_CLASS}>
                {translate('helix.structureViewer.sticks', 'Sticks')}
              </ToggleGroupItem>
              <ToggleGroupItem value="surface" className={TOGGLE_ITEM_CLASS}>
                {translate('helix.structureViewer.surface', 'Surface')}
              </ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={coloring}
              onValueChange={(value) =>
                setColoring((current) => COLORINGS.find((c) => c === value) ?? current)
              }
              aria-label={translate('helix.structureViewer.coloring', 'Coloring')}
            >
              <ToggleGroupItem value="spectrum" className={TOGGLE_ITEM_CLASS}>
                {translate('helix.structureViewer.spectrum', 'Spectrum')}
              </ToggleGroupItem>
              <ToggleGroupItem value="chain" className={TOGGLE_ITEM_CLASS}>
                {translate('helix.structureViewer.chain', 'Chain')}
              </ToggleGroupItem>
              <ToggleGroupItem value="confidence" className={TOGGLE_ITEM_CLASS}>
                {translate('helix.structureViewer.confidence', 'pLDDT')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        ) : null}
      </div>
      {error ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {translate(
            'helix.structureViewer.error',
            'Could not display this structure ({{value}}). Switch to Source to inspect the file.',
            { value: error }
          )}
        </div>
      ) : (
        <div ref={containerRef} className="relative min-h-0 flex-1" />
      )}
    </div>
  )
}
