// Status keeps only the latest deferral; log each refusal to preserve earlier failure reasons.
import { errorMessage } from '../../../shared/error-message'

type Unsettled = { outcome: string; code?: string; reason?: string }

export async function logHelixdActivationOutcome<T extends Unsettled>(
  operation: string,
  run: () => Promise<T>,
  settled: readonly string[]
): Promise<T> {
  let result: T
  try {
    result = await run()
  } catch (error) {
    console.warn(`[helixd] ${operation} failed: ${errorMessage(error)}`)
    throw error
  }
  if (!settled.includes(result.outcome)) {
    console.warn(
      `[helixd] ${operation} ${result.outcome} (${result.code ?? 'no code'}): ${result.reason ?? ''}`
    )
  }
  return result
}
