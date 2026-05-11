import { describe, it, expect, beforeAll } from 'vitest'
import type { CaribouListMount } from '@beatzball/caribou-ui-headless'

beforeAll(async () => { await import('../caribou-profile.js') })

const ACCOUNT = {
  id: '42', acct: 'alice@example.social', username: 'alice', displayName: 'A',
  avatar: '', avatarStatic: '', note: '', followersCount: 0, followingCount: 0,
  statusesCount: 0, header: '', headerStatic: '',
}
const STATUS = {
  id: '210', content: '<p>x</p>', account: ACCOUNT,
  createdAt: '2026-04-28T12:00:00Z',
}

// Flush microtasks + one macrotask tick (Elena schedules renders with
// queueMicrotask; settled renders are visible after a setTimeout(0) turn).
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('<caribou-profile>', () => {
  it('mounts header + tabs + status list when initial is provided', async () => {
    const el = document.createElement('caribou-profile') as HTMLElement & {
      handle: string; tab: string; initial: unknown
    }
    el.handle = '@alice@example.social'
    el.tab = 'media'
    el.initial = { account: ACCOUNT, statuses: [STATUS], nextMaxId: null, tab: 'media' }
    document.body.appendChild(el)
    await flush()
    await flush()
    expect(el.querySelector('caribou-profile-header')).toBeTruthy()
    expect(el.querySelector('caribou-profile-tabs')).toBeTruthy()
    // Cards are rendered inside <caribou-list-mount>'s shadow-DOM <ul>,
    // which is opaque to el.querySelectorAll. Access via mountUl instead.
    const mount = el.querySelector('caribou-list-mount') as CaribouListMount | null
    expect(mount).toBeTruthy()
    expect(mount!.mountUl.querySelectorAll('caribou-status-card').length).toBe(1)
  })
})
