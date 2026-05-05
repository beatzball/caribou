import { describe, it, expect } from 'vitest'
import { resolveInstanceForRoute } from '../resolve-instance.js'

const REGISTERED: Record<string, unknown> = {
  'apps:mastodon.social:https://caribou.local': { client_id: 'x' },
  'apps:fosstodon.org:https://caribou.local':  { client_id: 'y' },
}
const storage = { async getItem<T>(k: string): Promise<T | null> { return (REGISTERED[k] as T | undefined) ?? null } }
const deps = { storage, origin: 'https://caribou.local' }

function mkEvent(cookies: Record<string, string>) {
  return {
    node: { req: { headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') } }, res: { setHeader: () => {} } },
  } as unknown as Parameters<typeof resolveInstanceForRoute>[0]
}

describe('resolveInstanceForRoute', () => {
  it('host-qualified handle uses path host', async () => {
    const e = mkEvent({})
    const r = await resolveInstanceForRoute(e, { handle: '@alice@fosstodon.org' }, deps)
    expect(r).toEqual({ instance: 'fosstodon.org', source: 'path' })
  })

  it('host-qualified handle bypasses registry check', async () => {
    const e = mkEvent({})
    const r = await resolveInstanceForRoute(e, { handle: '@alice@unregistered.example' }, deps)
    expect(r).toEqual({ instance: 'unregistered.example', source: 'path' })
  })

  it('bare handle uses cookie when registered', async () => {
    const e = mkEvent({ 'caribou.instance': 'mastodon.social' })
    const r = await resolveInstanceForRoute(e, { handle: '@alice' }, deps)
    expect(r).toEqual({ instance: 'mastodon.social', source: 'cookie' })
  })

  it('no path host + no cookie → null', async () => {
    const e = mkEvent({})
    const r = await resolveInstanceForRoute(e, {}, deps)
    expect(r).toEqual({ instance: null })
  })

  it('cookie present but unregistered → null', async () => {
    const e = mkEvent({ 'caribou.instance': 'evil.com' })
    const r = await resolveInstanceForRoute(e, { handle: '@alice' }, deps)
    expect(r).toEqual({ instance: null })
  })
})
