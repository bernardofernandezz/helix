import type { Metadata } from 'next'
import { LandingPage } from '@/components/landing/LandingPage'

export const metadata: Metadata = {
  title: 'Helix: an agentic research environment for the life sciences',
  description:
    'Chat with Claude Code, Codex or any CLI agent on your research project: literature, biological databases, Nextflow and SLURM, and viewers for FASTA, VCF and 3D structures, with every answer cited.',
  alternates: { canonical: '/' }
}

export default function Home() {
  return <LandingPage />
}
