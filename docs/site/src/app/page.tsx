import type { Metadata } from 'next'
import { LandingPage } from '@/components/landing/LandingPage'

export const metadata: Metadata = {
  title: 'Helix: an agentic research environment for the life sciences',
  description:
    'Run AI agents side by side on research projects: literature, biological databases, Nextflow and Snakemake pipelines and SLURM jobs, with every answer cited.',
  alternates: { canonical: '/' }
}

export default function Home() {
  return <LandingPage />
}
