import { describe, it, expect, vi } from 'vitest'
import type * as H3 from 'h3'

const query = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return { ...actual, getQuery: () => query.value }
})

describe('/ pageData', () => {
  it('add is true for /?add (empty value) and /?add=1', async () => {
    const { pageData } = await import('../../pages/index.js')
    const event = {} as Parameters<typeof pageData.fetcher>[0]
    query.value = { add: '' }
    expect(await pageData.fetcher(event)).toEqual({ add: true })
    query.value = { add: '1' }
    expect(await pageData.fetcher(event)).toEqual({ add: true })
  })

  it('add is false without the parameter', async () => {
    const { pageData } = await import('../../pages/index.js')
    const event = {} as Parameters<typeof pageData.fetcher>[0]
    query.value = {}
    expect(await pageData.fetcher(event)).toEqual({ add: false })
    query.value = { error: 'denied' }
    expect(await pageData.fetcher(event)).toEqual({ add: false })
  })
})
