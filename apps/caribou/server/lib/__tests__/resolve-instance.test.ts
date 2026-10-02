import { describe, it, expect } from 'vitest'
import { resolveInstanceForRoute } from '../resolve-instance.js'

const REGISTERED_KEYS = [
  'apps:mastodon.social:https://caribou.local',
  'apps:fosstodon.org:https://caribou.local',
]
const storage = {
  async getKeys(prefix?: string): Promise<string[]> {
    return prefix ? REGISTERED_KEYS.filter((k) => k.startsWith(prefix)) : REGISTERED_KEYS
  },
}
const deps = { storage }

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
