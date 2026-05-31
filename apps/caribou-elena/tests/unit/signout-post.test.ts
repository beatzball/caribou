import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as H3 from 'h3'

const setCookieMock = vi.fn()
const setResponseStatusMock = vi.fn()

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return {
    ...actual,
    setCookie: setCookieMock,
    setResponseStatus: setResponseStatusMock,
    defineEventHandler: <T,>(fn: T) => fn,
  }
})

describe('POST /api/signout', () => {
  beforeEach(() => {
    setCookieMock.mockClear()
    setResponseStatusMock.mockClear()
  })

  it('returns 204 and does NOT clear the caribou.instance cookie', async () => {
    const { default: handler } = await import('../../server/routes/api/signout.post.js')
    const event = {} as Parameters<typeof handler>[0]
    await handler(event)
    expect(setResponseStatusMock).toHaveBeenCalledWith(event, 204)
    expect(setCookieMock).not.toHaveBeenCalled()
  })
})
