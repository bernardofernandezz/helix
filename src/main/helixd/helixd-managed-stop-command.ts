// Exit 0 means JSON was printed; read its outcome. Exit 64 is invalid input, 1 is failure without exit proof.
import {
  HELIXD_CANCEL_MANAGED_STOP_FLAG,
  HELIXD_COMPLETE_MANAGED_STOP_FLAG,
  HELIXD_MANAGED_STOP_REQUEST_FILE_FLAG,
  HelixdManagedStopRequestSchema,
  type HelixdManagedStopCancellation,
  type HelixdManagedStopCompletion,
  type HelixdManagedStopRequest
} from '../../shared/helixd-stop-request'
import { cancelHelixdManagedStop } from './helixd-managed-stop-cancellation'
import { readHelixdCompletedStopReceipt } from './helixd-completed-stop-receipt'
import { readHelixdManagedStopRequest } from './helixd-managed-stop-request'
import { ZodError } from 'zod'
import {
  completeHelixdManagedStop,
  type HelixdManagedStopCompletionOptions
} from './helixd-managed-stop-completion'

export async function runHelixdManagedStopCommand(
  argv: readonly string[],
  options: HelixdManagedStopCompletionOptions = {}
): Promise<HelixdManagedStopCompletion> {
  const request = parseRequestArgument(argv, HELIXD_COMPLETE_MANAGED_STOP_FLAG)
  const verdict = await completeHelixdManagedStop(request, options)
  const retirement =
    verdict === 'exited' && request.retireIdleDaemon
      ? readHelixdCompletedStopReceipt(request)?.retirement
      : undefined
  const completion: HelixdManagedStopCompletion = {
    ...request,
    kind: 'helixd_managed_stop_completion',
    verdict,
    receiptPersisted: verdict === 'exited',
    ...(retirement ? { retirement } : {})
  }
  process.stdout.write(`${JSON.stringify(completion)}\n`)
  return completion
}

export function runHelixdManagedStopCancelCommand(
  argv: readonly string[]
): HelixdManagedStopCancellation {
  const request = parseRequestArgument(argv, HELIXD_CANCEL_MANAGED_STOP_FLAG)
  const cancellation: HelixdManagedStopCancellation = {
    ...request,
    kind: 'helixd_managed_stop_cancellation',
    outcome: cancelHelixdManagedStop(request)
  }
  process.stdout.write(`${JSON.stringify(cancellation)}\n`)
  return cancellation
}

function parseRequestArgument(argv: readonly string[], flag: string): HelixdManagedStopRequest {
  if (argv[0] !== flag) {
    throw new Error('helixd_managed_stop_invalid_arguments')
  }
  if (argv[1] === HELIXD_MANAGED_STOP_REQUEST_FILE_FLAG) {
    if (argv.length !== 3 || !argv[2]) {
      throw new Error('helixd_managed_stop_invalid_arguments')
    }
    return readHelixdManagedStopRequest(argv[2])
  }
  if (argv.length !== 2 || !argv[1]) {
    throw new Error('helixd_managed_stop_invalid_arguments')
  }
  return HelixdManagedStopRequestSchema.parse(JSON.parse(argv[1]))
}

export const HELIXD_MANAGED_STOP_EXIT_VERDICT = 0
export const HELIXD_MANAGED_STOP_EXIT_FAILED = 1
export const HELIXD_MANAGED_STOP_EXIT_USAGE = 64

export async function runHelixdManagedStopCommandAndExit(argv: readonly string[]): Promise<void> {
  let code = HELIXD_MANAGED_STOP_EXIT_VERDICT
  try {
    if (argv[0] === HELIXD_CANCEL_MANAGED_STOP_FLAG) {
      runHelixdManagedStopCancelCommand(argv)
    } else {
      await runHelixdManagedStopCommand(argv)
    }
  } catch (error) {
    console.error('helixd: managed stop failed:', error)
    code =
      error instanceof ZodError ||
      error instanceof SyntaxError ||
      (error instanceof Error && error.message === 'helixd_managed_stop_invalid_arguments')
        ? HELIXD_MANAGED_STOP_EXIT_USAGE
        : HELIXD_MANAGED_STOP_EXIT_FAILED
  }
  // Drain stdout before exit: callers read the result to EOF.
  process.stdout.write('', () => process.exit(code))
}
