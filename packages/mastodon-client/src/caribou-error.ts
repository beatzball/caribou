export type CaribouErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'rate_limited'
  | 'unreachable'
  | 'server_error'
  | 'unknown'

export class CaribouError extends Error {
  readonly code: CaribouErrorCode
  readonly retryAfter?: number

  constructor(
    code: CaribouErrorCode,
    message: string,
    opts: { retryAfter?: number } = {},
  ) {
    super(message)
    this.name = 'CaribouError'
    this.code = code
    if (opts.retryAfter !== undefined) this.retryAfter = opts.retryAfter
  }
}
