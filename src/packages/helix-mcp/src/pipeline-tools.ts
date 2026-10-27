import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  SSH_HOST_PATTERN,
  newestFile,
  readFileTail,
  runOnHost,
  shellQuote,
  type CommandRunner
} from './host-command.js'
import {
  SACCT_FIELDS,
  SQUEUE_FORMAT,
  parseSacct,
  parseSbatchJobId,
  parseSqueue
} from './slurm-output-parsing.js'
import { jsonResult, withToolErrors } from './tool-result.js'
import {
  parseNextflowHistory,
  parseSnakemakeLog,
  summarizeNextflowTrace
} from './workflow-log-parsing.js'

const LOG_TAIL_BYTES = 2 * 1024 * 1024

const host = z
  .string()
  .regex(SSH_HOST_PATTERN, 'an SSH host alias from ~/.ssh/config or user@host')
  .optional()
  .describe('SSH host where the files live; omit for this machine')
const requiredHost = z
  .string()
  .regex(SSH_HOST_PATTERN, 'an SSH host alias from ~/.ssh/config or user@host')
  .describe('SSH host of the cluster login node (alias from ~/.ssh/config or user@host)')
const jobId = z.string().regex(/^\d+(_\d+)?$/, 'a numeric SLURM job id (array tasks as 123_4)')

// Forward slashes work for local paths on Windows too, and are required over SSH.
function joinPath(dir: string, child: string): string {
  return `${dir.replace(/[\\/]+$/, '')}/${child}`
}

export type PipelineToolOptions = {
  runner: CommandRunner
  allowSlurmWrite: boolean
}

export function registerPipelineTools(server: McpServer, options: PipelineToolOptions): void {
  const { runner } = options

  server.registerTool(
    'nextflow_runs',
    {
      title: 'List Nextflow runs',
      description:
        'List the Nextflow runs launched from a project directory (name, status OK/ERR/running, duration, command), newest first.',
      inputSchema: {
        project_dir: z.string().min(1),
        host,
        max_runs: z.number().int().min(1).max(200).default(20)
      },
      annotations: { readOnlyHint: true }
    },
    withToolErrors(async ({ project_dir, host, max_runs }) => {
      const history = await readFileTail(
        runner,
        joinPath(project_dir, '.nextflow/history'),
        LOG_TAIL_BYTES,
        host
      )
      return jsonResult(parseNextflowHistory(history).toReversed().slice(0, max_runs))
    })
  )

  server.registerTool(
    'nextflow_trace_summary',
    {
      title: 'Summarize a Nextflow trace',
      description:
        'Summarize a Nextflow trace file (-with-trace): task counts by status, failed tasks with exit code and work dir, slowest tasks.',
      inputSchema: { trace_path: z.string().min(1), host },
      annotations: { readOnlyHint: true }
    },
    withToolErrors(async ({ trace_path, host }) =>
      jsonResult(
        summarizeNextflowTrace(await readFileTail(runner, trace_path, LOG_TAIL_BYTES, host))
      )
    )
  )

  server.registerTool(
    'snakemake_progress',
    {
      title: 'Check Snakemake progress',
      description:
        'Read the newest Snakemake log in a workflow directory: state (running, complete, failed), steps done, failed rules and the last log lines.',
      inputSchema: { workflow_dir: z.string().min(1), host },
      annotations: { readOnlyHint: true }
    },
    withToolErrors(async ({ workflow_dir, host }) => {
      const logDir = joinPath(workflow_dir, '.snakemake/log')
      const log = await newestFile(runner, logDir, '.snakemake.log', host)
      if (!log) {
        return jsonResult({ state: 'no-log', logDir })
      }
      return jsonResult({
        log,
        ...parseSnakemakeLog(await readFileTail(runner, log, LOG_TAIL_BYTES, host))
      })
    })
  )

  server.registerTool(
    'slurm_queue',
    {
      title: 'List SLURM jobs',
      description: 'List queued and running SLURM jobs on a cluster over SSH (yours by default).',
      inputSchema: {
        host: requiredHost,
        user: z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/)
          .optional()
          .describe('cluster user name; defaults to the SSH user')
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    withToolErrors(async ({ host, user }) => {
      const who = user ? `-u ${shellQuote(user)}` : '--me'
      const out = await runOnHost(runner, host, `squeue ${who} -h -o ${shellQuote(SQUEUE_FORMAT)}`)
      return jsonResult(parseSqueue(out))
    })
  )

  server.registerTool(
    'slurm_job',
    {
      title: 'Get SLURM job accounting',
      description:
        'Get sacct accounting for a SLURM job and its steps: state, elapsed time, CPUs, requested and peak memory, exit code, nodes.',
      inputSchema: { host: requiredHost, job_id: jobId },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    withToolErrors(async ({ host, job_id }) => {
      const out = await runOnHost(
        runner,
        host,
        `sacct -j ${job_id} --parsable2 --noheader --format=${SACCT_FIELDS.join(',')}`
      )
      return jsonResult(parseSacct(out))
    })
  )

  if (!options.allowSlurmWrite) {
    return
  }

  server.registerTool(
    'slurm_submit',
    {
      title: 'Submit a SLURM batch script',
      description:
        'Submit an existing batch script on the cluster with sbatch from a working directory and return the job id. Ask the user before submitting.',
      inputSchema: {
        host: requiredHost,
        script_path: z.string().min(1).describe('path of the batch script on the cluster'),
        working_dir: z.string().min(1).describe('directory on the cluster to submit from')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
    },
    withToolErrors(async ({ host, script_path, working_dir }) => {
      const out = await runOnHost(
        runner,
        host,
        `cd -- ${shellQuote(working_dir)} && sbatch --parsable -- ${shellQuote(script_path)}`
      )
      return jsonResult({ jobId: parseSbatchJobId(out), host, script: script_path })
    })
  )

  server.registerTool(
    'slurm_cancel',
    {
      title: 'Cancel a SLURM job',
      description: 'Cancel one of your SLURM jobs with scancel. Ask the user before cancelling.',
      inputSchema: { host: requiredHost, job_id: jobId },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
    },
    withToolErrors(async ({ host, job_id }) => {
      await runOnHost(runner, host, `scancel ${job_id}`)
      return jsonResult({ cancelled: job_id, host })
    })
  )
}
