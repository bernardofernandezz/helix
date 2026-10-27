export const SQUEUE_FORMAT = '%i|%j|%T|%M|%l|%D|%P|%R'

export type SlurmQueueEntry = {
  jobId: string
  name: string
  state: string
  elapsed: string
  timeLimit: string
  nodes: string
  partition: string
  reason: string
}

export function parseSqueue(text: string): SlurmQueueEntry[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [
        jobId = '',
        name = '',
        state = '',
        elapsed = '',
        timeLimit = '',
        nodes = '',
        partition = '',
        ...reason
      ] = line.split('|')
      return { jobId, name, state, elapsed, timeLimit, nodes, partition, reason: reason.join('|') }
    })
}

export const SACCT_FIELDS = [
  'JobID',
  'JobName',
  'Partition',
  'State',
  'Elapsed',
  'Timelimit',
  'AllocCPUS',
  'ReqMem',
  'MaxRSS',
  'ExitCode',
  'NodeList'
] as const

export type SacctRow = Record<(typeof SACCT_FIELDS)[number], string>

/** Parses `sacct --parsable2 --noheader --format=<SACCT_FIELDS>` output. */
export function parseSacct(text: string): SacctRow[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [
        JobID = '',
        JobName = '',
        Partition = '',
        State = '',
        Elapsed = '',
        Timelimit = '',
        AllocCPUS = '',
        ReqMem = '',
        MaxRSS = '',
        ExitCode = '',
        NodeList = ''
      ] = line.split('|')
      return {
        JobID,
        JobName,
        Partition,
        State,
        Elapsed,
        Timelimit,
        AllocCPUS,
        ReqMem,
        MaxRSS,
        ExitCode,
        NodeList
      }
    })
}

/** `sbatch --parsable` prints "<jobid>" or "<jobid>;<cluster>". */
export function parseSbatchJobId(text: string): string {
  const id = text.trim().split(';')[0] ?? ''
  if (!/^\d+$/.test(id)) {
    throw new Error(`sbatch did not return a job id: ${text.trim().slice(0, 300)}`)
  }
  return id
}
