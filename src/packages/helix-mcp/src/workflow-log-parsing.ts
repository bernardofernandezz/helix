export type NextflowRun = {
  started: string
  duration: string
  runName: string
  status: 'OK' | 'ERR' | 'running'
  revision: string
  sessionId: string
  command: string
}

/** Parses `.nextflow/history`: one tab-separated line per run, newest last. */
export function parseNextflowHistory(text: string): NextflowRun[] {
  return text
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((fields) => fields.length >= 7)
    .map(([started, duration, runName, status, revision, sessionId, ...command]) => ({
      started: started ?? '',
      duration: duration === '-' ? '' : (duration ?? ''),
      runName: runName ?? '',
      status: status === 'OK' ? 'OK' : status === 'ERR' ? 'ERR' : 'running',
      revision: revision ?? '',
      sessionId: sessionId ?? '',
      command: command.join('\t')
    }))
}

export type NextflowTraceSummary = {
  tasks: number
  byStatus: Record<string, number>
  failed: { name: string; exit: string; hash: string; workdir: string | null }[]
  slowest: { name: string; realtime: string }[]
}

/** Summarizes a Nextflow trace file (`-with-trace`, tab-separated with a header row). */
export function summarizeNextflowTrace(text: string, maxListed = 20): NextflowTraceSummary {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  const header = lines[0]?.split('\t') ?? []
  const column = (name: string) => header.indexOf(name)
  const rows = lines.slice(1).map((line) => line.split('\t'))
  const pick = (row: string[], name: string) => {
    const index = column(name)
    return index >= 0 ? (row[index] ?? '') : ''
  }
  const byStatus: Record<string, number> = {}
  for (const row of rows) {
    const status = pick(row, 'status') || 'UNKNOWN'
    byStatus[status] = (byStatus[status] ?? 0) + 1
  }
  const failed = rows
    .filter((row) => pick(row, 'status') === 'FAILED')
    .slice(0, maxListed)
    .map((row) => ({
      name: pick(row, 'name'),
      exit: pick(row, 'exit'),
      hash: pick(row, 'hash'),
      workdir: pick(row, 'workdir') || null
    }))
  const slowest = rows
    .map((row) => ({ name: pick(row, 'name'), realtime: pick(row, 'realtime') }))
    .filter((row) => row.realtime && row.realtime !== '-')
    .sort((a, b) => durationSeconds(b.realtime) - durationSeconds(a.realtime))
    .slice(0, 5)
  return { tasks: rows.length, byStatus, failed, slowest }
}

/** Converts Nextflow durations such as "1h 2m 3s", "450ms" or "2d 1h" to seconds. */
export function durationSeconds(value: string): number {
  const units: Record<string, number> = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400 }
  let total = 0
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/g)) {
    total += Number(match[1]) * (units[match[2] ?? 's'] ?? 0)
  }
  return total
}

export type SnakemakeProgress = {
  state: 'complete' | 'failed' | 'running' | 'nothing-to-do'
  stepsDone: number | null
  stepsTotal: number | null
  percent: number | null
  failedRules: string[]
  lastLines: string[]
}

/** Reads progress from a Snakemake log (`.snakemake/log/*.snakemake.log`). */
export function parseSnakemakeLog(text: string): SnakemakeProgress {
  const lines = text.split('\n')
  let stepsDone: number | null = null
  let stepsTotal: number | null = null
  let percent: number | null = null
  for (const match of text.matchAll(/(\d+) of (\d+) steps \((\d+(?:\.\d+)?)%\) done/g)) {
    stepsDone = Number(match[1])
    stepsTotal = Number(match[2])
    percent = Number(match[3])
  }
  const failedRules = [
    ...new Set([...text.matchAll(/Error in rule (\S+?):/g)].map((m) => m[1] ?? ''))
  ]
  const nothingToDo = /Nothing to be done/.test(text)
  const finishedWithError =
    /Exiting because a job execution failed|WorkflowError|Shutting down, this might take some time\./.test(
      text
    )
  let state: SnakemakeProgress['state'] = 'running'
  if (nothingToDo) {
    state = 'nothing-to-do'
  } else if (failedRules.length > 0 || finishedWithError) {
    state = 'failed'
  } else if (stepsDone !== null && stepsDone === stepsTotal) {
    state = 'complete'
  }
  return {
    state,
    stepsDone,
    stepsTotal,
    percent,
    failedRules,
    lastLines: lines.filter((line) => line.trim() !== '').slice(-15)
  }
}
