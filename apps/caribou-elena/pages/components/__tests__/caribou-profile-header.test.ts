import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => { await import('../caribou-profile-header.js') })

const ACCOUNT = {
  id: '42', acct: 'alice@example.social', username: 'alice', displayName: 'Alice',
  avatar: '', avatarStatic: '', note: '<p>bio</p>', followersCount: 10, followingCount: 20, statusesCount: 30,
  header: '', headerStatic: '',
}

describe('<caribou-profile-header>', () => {
  it('renders avatar, display name, handle, bio, counts', async () => {
    const el = document.createElement('caribou-profile-header') as HTMLElement & { account: unknown }
    el.account = ACCOUNT
    document.body.appendChild(el)
    await Promise.resolve()
    const root = el.shadowRoot!
    expect(root.textContent).toContain('Alice')
    expect(root.textContent).toContain('@alice@example.social')
    expect(root.querySelector('.bio')?.innerHTML).toContain('bio')
    expect(root.textContent).toContain('10')
    expect(root.textContent).toContain('20')
    expect(root.textContent).toContain('30')
  })
})
