import { describe, it, expect, vi } from 'vitest'
import type * as H3 from 'h3'

const sendRedirectMock = vi.fn()

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return { ...actual, sendRedirect: sendRedirectMock }
})

describe('/feed redirect', () => {
  it('issues 301 to /home', async () => {
    sendRedirectMock.mockClear()
    const { default: handler } = await import('../feed.js')
    const event = {} as Parameters<typeof handler>[0]
    await handler(event)
    expect(sendRedirectMock).toHaveBeenCalledWith(event, '/home', 301)
  })
})
