import { describe, expect, it } from 'vitest'
import { runProcess } from '@helix/process-host'
import {
  orchestrationMutationRecoveryError,
  renderCommand,
  renderResolvedOrchestrationCommand
} from './orchestration-mutation-recovery'
import { RuntimeClientError } from './runtime-client'

describe('orchestration mutation recovery', () => {
  it('queries a known dispatch before issuing the keyed retry', () => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_1',
        dispatchId: 'dispatch_1',
        originalCommand: ['helix', 'orchestration', 'worker-start', '--task', 'task_1']
      })
    ) as RuntimeClientError

    expect(result.data).toMatchObject({
      recovery: {
        orchestrationRequestId: 'request_1',
        dispatchId: 'dispatch_1',
        queryCommand: [
          'helix',
          'orchestration',
          'worker-show',
          '--dispatch',
          'dispatch_1',
          '--json'
        ],
        retryCommand: [
          'helix',
          'orchestration',
          'worker-start',
          '--task',
          'task_1',
          '--retry-request',
          'request_1'
        ],
        workerDeathInferred: false
      }
    })
    expect(result.message.indexOf('helix orchestration worker-show')).toBeLessThan(
      result.message.indexOf('helix orchestration worker-start')
    )
    expect((result.data as { nextSteps?: string[] }).nextSteps).toEqual([
      'Run helix orchestration worker-show --dispatch dispatch_1 --json before retrying.',
      'After inspecting the Dispatch, if keyed recovery is still needed, run helix orchestration worker-start --task task_1 --retry-request request_1 from this same terminal. --retry-request reuses the same operation identity so Helix can replay, join, or safely recover it without starting a separate duplicate.'
    ])
  })

  it('does not invent a dispatch for an old-client-shaped error', () => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_2',
        originalCommand: ['helix', 'orchestration', 'worker-start', '--task', 'task_2']
      })
    ) as RuntimeClientError

    expect(result.data).toMatchObject({
      recovery: {
        orchestrationRequestId: 'request_2',
        retryCommand: expect.arrayContaining(['--retry-request', 'request_2']),
        workerDeathInferred: false
      }
    })
    expect((result.data as Record<string, unknown>).recovery).not.toHaveProperty('dispatchId')
    expect(result.message).not.toContain('worker death')
  })

  it('offers a read-only request lookup when the response carried no dispatch', () => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_unavailable', 'runtime unavailable', {
        orchestrationRequestId: 'request_4',
        originalCommand: ['helix', 'orchestration', 'worker-start', '--task', 'task_4']
      })
    ) as RuntimeClientError

    expect(result.data).toMatchObject({
      recovery: {
        queryCommand: ['helix', 'orchestration', 'request-show', '--request', 'request_4', '--json']
      }
    })
    expect((result.data as { nextSteps?: string[] }).nextSteps?.[0]).toBe(
      'Run helix orchestration request-show --request request_4 --json before retrying.'
    )
  })

  it('describes keyed retry without overclaiming one replay outcome', () => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_5',
        originalCommand: ['helix', 'orchestration', 'worker-start', '--task', 'task_5']
      })
    ) as RuntimeClientError

    expect((result.data as { nextSteps?: string[] }).nextSteps?.[1]).toContain(
      'replay, join, or safely recover it without starting a separate duplicate'
    )
    expect((result.data as { nextSteps?: string[] }).nextSteps?.[1]).toContain(
      'absence does not prove a retry is safe'
    )
  })

  it('renders the exact executable and safely quotes original arguments', () => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_3',
        dispatchId: 'dispatch_3',
        originalCommand: [
          'helix-dev',
          'orchestration',
          'worker-start',
          '--task',
          'task 3',
          '--comment',
          'literal $(do-not-run)'
        ]
      })
    ) as RuntimeClientError

    expect((result.data as { nextSteps?: string[] }).nextSteps).toEqual([
      'Run helix-dev orchestration worker-show --dispatch dispatch_3 --json before retrying.',
      "After inspecting the Dispatch, if keyed recovery is still needed, run helix-dev orchestration worker-start --task 'task 3' --comment 'literal $(do-not-run)' --retry-request request_3 from this same terminal. --retry-request reuses the same operation identity so Helix can replay, join, or safely recover it without starting a separate duplicate."
    ])
    expect(result.message).toContain("'literal $(do-not-run)'")
  })

  it('parses legacy command text without losing quoted arguments', () => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_4',
        originalCommand:
          'helix-ide orchestration worker-stop --dispatch dispatch_4 --comment "quoted value"'
      })
    ) as RuntimeClientError

    expect(
      (result.data as { recovery?: { retryCommand?: string[] } }).recovery?.retryCommand
    ).toEqual([
      'helix-ide',
      'orchestration',
      'worker-stop',
      '--dispatch',
      'dispatch_4',
      '--comment',
      'quoted value',
      '--retry-request',
      'request_4'
    ])
  })

  it.each([
    [
      'gate-create',
      ['helix', 'orchestration', 'gate-create', '--task', 'task_1', '--question', 'ship?']
    ],
    [
      'worker-retain',
      ['helix', 'orchestration', 'worker-retain', '--dispatch', 'dispatch_1', '--json']
    ]
  ])('replays exact %s argv with the keyed retry', (_name, originalCommand) => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_exact',
        originalCommand
      })
    ) as RuntimeClientError

    expect(
      (result.data as { recovery?: { retryCommand?: string[] } }).recovery?.retryCommand
    ).toEqual([...originalCommand, '--retry-request', 'request_exact'])
  })

  it('reuses the request identity without duplicating an existing retry flag', () => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_reused',
        originalCommand: [
          'helix',
          'orchestration',
          'worker-retain',
          '--dispatch',
          'dispatch_1',
          '--retry-request=request_reused'
        ]
      })
    ) as RuntimeClientError

    expect(
      (result.data as { recovery?: { retryCommand?: string[] } }).recovery?.retryCommand
    ).toEqual([
      'helix',
      'orchestration',
      'worker-retain',
      '--dispatch',
      'dispatch_1',
      '--retry-request',
      'request_reused'
    ])
  })

  it('renders Windows cmd recovery guidance without quote drift or percent expansion', () => {
    expect(
      renderCommand(
        ['helix', 'orchestration', 'worker-start', '--comment', 'literal "quoted" %PATH% & safe'],
        'win32',
        { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
      )
    ).toBe(
      '"helix" "orchestration" "worker-start" "--comment" "literal ""quoted"" "^%"PATH"^%" & safe"'
    )
  })

  it('shell-quotes a configured Windows executable when resolving portable recovery commands', () => {
    expect(
      renderResolvedOrchestrationCommand(
        'helix orchestration worker-show --dispatch ctx_1 --json',
        'C:\\Program Files\\Helix\\helix-ide.cmd',
        'win32',
        { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
      )
    ).toBe(
      '"C:\\Program Files\\Helix\\helix-ide.cmd" "orchestration" "worker-show" "--dispatch" "ctx_1" "--json"'
    )
  })

  it('keeps PowerShell and POSIX recovery guidance literal', () => {
    expect(
      renderCommand(['helix', 'literal "quoted" $HOME'], 'win32', {
        ComSpec: 'powershell.exe'
      })
    ).toBe("& 'helix' 'literal \\\"quoted\\\" $HOME'")
    expect(renderCommand(['helix', 'literal $(do-not-run)'], 'darwin')).toBe(
      "helix 'literal $(do-not-run)'"
    )
  })

  it.runIf(process.platform !== 'win32')(
    'round trips POSIX recovery argv through /bin/sh',
    async () => {
      const values = ['with spaces', "apostrophe's", 'literal $(do-not-run)', 'line one\nline two']
      const command = renderCommand(
        [
          process.execPath,
          '-e',
          'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
          ...values
        ],
        'darwin'
      )

      const result = await runProcess({ program: '/bin/sh', args: ['-c', command] })

      expect(result).toMatchObject({ code: 0, stderr: '', timedOut: false })
      expect(JSON.parse(result.stdout)).toEqual(values)
    }
  )

  it.each([
    [
      'split',
      ['helix', 'orchestration', 'send', '--pairing-code', 'split-secret', '--subject', 'status'],
      'split-secret'
    ],
    [
      'equals',
      ['helix', 'orchestration', 'send', '--pairing-code=equals-secret', '--subject', 'status'],
      'equals-secret'
    ],
    [
      'dispatch split',
      [
        'helix',
        'orchestration',
        'send',
        '--dispatch-capability',
        'split-dispatch-secret',
        '--subject',
        'status'
      ],
      'split-dispatch-secret'
    ],
    [
      'dispatch equals',
      [
        'helix',
        'orchestration',
        'send',
        '--dispatch-capability=equals-dispatch-secret',
        '--subject',
        'status'
      ],
      'equals-dispatch-secret'
    ]
  ])('blocks recovery and removes %s credentials', (_name, originalCommand, secret) => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_secret',
        originalCommand
      })
    ) as RuntimeClientError
    const output = JSON.stringify({ message: result.message, data: result.data })

    expect(output).not.toContain(secret)
    expect(result.message).toContain('Recovery is blocked')
    expect(result.data).toMatchObject({
      recovery: {
        orchestrationRequestId: 'request_secret',
        recoveryBlocked: true
      }
    })
    expect(result.data).not.toHaveProperty('originalCommand')
    expect((result.data as { recovery: object }).recovery).not.toHaveProperty('retryCommand')
  })

  it.each([
    ['runtime_unavailable', true],
    ['remote_runtime_unavailable', true],
    ['runtime_timeout', true],
    ['invalid_runtime_response', true],
    ['runtime_manually_disconnected', false],
    ['remote_runtime_timeout', false],
    ['runtime_rpc_queue_overloaded', false],
    ['invalid_argument', false]
  ])('treats %s as an unknown mutation outcome: %s', (code, unknown) => {
    const error = new RuntimeClientError(code, 'failed', { orchestrationRequestId: 'request-1' })
    expect(orchestrationMutationRecoveryError(error) !== error).toBe(unknown)
  })
})
