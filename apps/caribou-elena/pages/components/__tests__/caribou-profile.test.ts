import { describe, it, expect, beforeAll } from 'vitest'

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

describe('<caribou-profile>', () => {
  it('mounts header + tabs + status list when initial is provided', async () => {
    const el = document.createElement('caribou-profile') as HTMLElement & {
      handle: string; tab: string; initial: unknown
    }
    el.handle = '@alice@example.social'
    el.tab = 'media'
    el.initial = { account: ACCOUNT, statuses: [STATUS], nextMaxId: null, tab: 'media' }
    document.body.appendChild(el)
    await Promise.resolve()
    await Promise.resolve()
    expect(el.querySelector('caribou-profile-header')).toBeTruthy()
    expect(el.querySelector('caribou-profile-tabs')).toBeTruthy()
    expect(el.querySelectorAll('caribou-status-card').length).toBe(1)
  })
})
