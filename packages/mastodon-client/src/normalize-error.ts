import { CaribouError } from './caribou-error.js'

interface HttpErrorLike {
  statusCode: number
  headers?: Record<string, string>
  message: string
}

function isHttpErrorLike(e: unknown): e is HttpErrorLike {
  return (
    !!e && typeof e === 'object' &&
    'statusCode' in e && typeof (e as { statusCode: unknown }).statusCode === 'number'
  )
}

export function normalizeError(err: unknown): CaribouError {
  if (err instanceof CaribouError) return err

  if (isHttpErrorLike(err)) {
    const { statusCode, headers, message } = err
    if (statusCode === 401) return new CaribouError('unauthorized', message)
    if (statusCode === 404) return new CaribouError('not_found', message)
    if (statusCode === 429) {
      const retryAfterHeader = headers?.['retry-after']
      const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined
      return new CaribouError('rate_limited', message, { retryAfter })
    }
    if (statusCode >= 500) return new CaribouError('server_error', message)
    return new CaribouError('unknown', message)
  }

  if (err instanceof TypeError && /fetch failed|network|Failed to fetch/i.test(err.message)) {
    return new CaribouError('unreachable', err.message)
  }

  const message = err instanceof Error ? err.message : String(err)
  return new CaribouError('unknown', message)
}
