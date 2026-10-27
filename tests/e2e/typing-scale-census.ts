import type { Page } from '@playwright/test'
import type {
  TypingDiagnosticBridge,
  TypingLatencyReport
} from '../../src/renderer/src/lib/typing-latency/diagnostic'

/** Reads the existing census without enabling per-keystroke diagnostic instrumentation. */
export async function readTypingScaleCensus(
  page: Page
): Promise<TypingLatencyReport['census'] | null> {
  return page.evaluate(() => {
    const target: Window & { __helixTypingDiagnostic?: TypingDiagnosticBridge } = window
    return target.__helixTypingDiagnostic?.report().census ?? null
  })
}
