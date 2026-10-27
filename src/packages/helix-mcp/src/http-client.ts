const USER_AGENT = 'helix-mcp/0.1 (+https://github.com/bernardofernandezz/helix)'
const REQUEST_TIMEOUT_MS = 30_000

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'UpstreamError'
  }
}

export type RequestOptions = {
  headers?: Record<string, string>
  body?: unknown
  // Some APIs answer "nothing found" with 404/204 instead of an empty list.
  allowEmpty?: boolean
}

export type HttpClient = {
  getJson(url: string | URL, options?: RequestOptions): Promise<unknown>
  getText(url: string | URL, options?: RequestOptions): Promise<string>
  postJson(url: string | URL, options: RequestOptions): Promise<unknown>
}

export function createHttpClient(fetchImpl: typeof fetch = fetch): HttpClient {
  async function request(
    method: 'GET' | 'POST',
    url: string | URL,
    accept: string,
    options: RequestOptions = {}
  ): Promise<string | null> {
    const headers: Record<string, string> = {
      Accept: accept,
      'User-Agent': USER_AGENT,
      ...options.headers
    }
    let body: string | undefined
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
    const response = await fetchImpl(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (options.allowEmpty && (response.status === 204 || response.status === 404)) {
      return null
    }
    const text = await response.text()
    if (!response.ok) {
      throw new UpstreamError(
        `${new URL(url).host} answered ${response.status}: ${text.slice(0, 300)}`,
        response.status
      )
    }
    return text
  }

  function parseJson(text: string | null, url: string | URL): unknown {
    if (text === null || text.trim() === '') {
      return null
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new UpstreamError(`${new URL(url).host} returned invalid JSON`)
    }
  }

  return {
    async getJson(url, options) {
      return parseJson(await request('GET', url, 'application/json', options), url)
    },
    async getText(url, options) {
      return (await request('GET', url, 'text/plain, */*', options)) ?? ''
    },
    async postJson(url, options) {
      return parseJson(await request('POST', url, 'application/json', options), url)
    }
  }
}

/** Serializes calls so they start at least `intervalMs` apart (NCBI allows 3/s, 10/s with a key). */
export function createRequestSpacer(intervalMs: number): <T>(task: () => Promise<T>) => Promise<T> {
  let nextStart = 0
  let queue: Promise<unknown> = Promise.resolve()
  return (task) => {
    const run = queue.then(async () => {
      const wait = nextStart - Date.now()
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait))
      }
      nextStart = Date.now() + intervalMs
      return task()
    })
    queue = run.catch(() => undefined)
    return run
  }
}
