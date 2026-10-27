import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const MAX_RESULT_CHARS = 60_000

export function truncateText(text: string, maxChars = MAX_RESULT_CHARS): string {
  if (text.length <= maxChars) {
    return text
  }
  return `${text.slice(0, maxChars)}\n… [truncated ${text.length - maxChars} characters]`
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text: truncateText(text) }] }
}

export function jsonResult(data: unknown): CallToolResult {
  return textResult(JSON.stringify(data, null, 2))
}

/** Every database answer carries its source and retrieval time so agents can cite it. */
export function sourcedResult(source: string, data: unknown): CallToolResult {
  return textResult(
    JSON.stringify({ source, retrievedAt: new Date().toISOString(), data }, null, 2)
  )
}

export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

export function withToolErrors<Args>(
  handler: (args: Args) => Promise<CallToolResult>
): (args: Args) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await handler(args)
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  }
}
