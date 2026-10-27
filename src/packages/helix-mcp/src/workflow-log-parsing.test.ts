import { describe, expect, it } from 'vitest'
import {
  durationSeconds,
  parseNextflowHistory,
  parseSnakemakeLog,
  summarizeNextflowTrace
} from './workflow-log-parsing.js'

describe('parseNextflowHistory', () => {
  it('reads finished, failed and running runs', () => {
    const history = [
      '2026-10-01 10:00:00\t1h 2m\tsharp_curie\tOK\tabc123\tsess-1\tnextflow run nf-core/rnaseq -profile docker',
      '2026-10-02 09:00:00\t5m\tbold_turing\tERR\tabc123\tsess-2\tnextflow run main.nf',
      '2026-10-03 08:00:00\t-\tcalm_hopper\t-\tabc123\tsess-3\tnextflow run main.nf -resume'
    ].join('\n')
    expect(
      parseNextflowHistory(history).map((run) => [run.runName, run.status, run.duration])
    ).toEqual([
      ['sharp_curie', 'OK', '1h 2m'],
      ['bold_turing', 'ERR', '5m'],
      ['calm_hopper', 'running', '']
    ])
  })
})

describe('summarizeNextflowTrace', () => {
  it('counts statuses and lists failed and slowest tasks', () => {
    const trace = [
      'task_id\thash\tname\tstatus\texit\trealtime\tworkdir',
      '1\tab/12\tFASTQC (s1)\tCOMPLETED\t0\t2m 3s\t/w/ab/12',
      '2\tcd/34\tSTAR_ALIGN (s1)\tFAILED\t137\t1h 4m\t/w/cd/34',
      '3\tef/56\tSTAR_ALIGN (s2)\tCOMPLETED\t0\t58m\t/w/ef/56'
    ].join('\n')
    const summary = summarizeNextflowTrace(trace)
    expect(summary.byStatus).toEqual({ COMPLETED: 2, FAILED: 1 })
    expect(summary.failed).toEqual([
      { name: 'STAR_ALIGN (s1)', exit: '137', hash: 'cd/34', workdir: '/w/cd/34' }
    ])
    expect(summary.slowest[0]?.name).toBe('STAR_ALIGN (s1)')
  })

  it('converts Nextflow durations', () => {
    expect(durationSeconds('1h 2m 3s')).toBe(3723)
    expect(durationSeconds('450ms')).toBeCloseTo(0.45)
    expect(durationSeconds('2d')).toBe(172800)
  })
})

describe('parseSnakemakeLog', () => {
  it('reports progress while running', () => {
    const log = 'Building DAG of jobs...\n3 of 10 steps (30%) done\n4 of 10 steps (40%) done\n'
    expect(parseSnakemakeLog(log)).toMatchObject({
      state: 'running',
      stepsDone: 4,
      stepsTotal: 10,
      percent: 40
    })
  })

  it('detects completion, failures and no-op runs', () => {
    expect(parseSnakemakeLog('10 of 10 steps (100%) done\nComplete log: x').state).toBe('complete')
    const failed = parseSnakemakeLog(
      '2 of 10 steps (20%) done\nError in rule bwa_map:\n    jobid: 3\nExiting because a job execution failed.'
    )
    expect(failed.state).toBe('failed')
    expect(failed.failedRules).toEqual(['bwa_map'])
    expect(parseSnakemakeLog('Nothing to be done (all requested files are present).').state).toBe(
      'nothing-to-do'
    )
  })
})
