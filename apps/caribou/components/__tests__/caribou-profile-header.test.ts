import { afterEach, describe, expect, it } from 'vitest'
import type { Account } from '@beatzball/caribou-mastodon-client'
import '../caribou-profile-header.js'
import type { CaribouProfileHeader } from '../caribou-profile-header.js'

const ACCOUNT = {
  id: '42', acct: 'alice@example.social', username: 'alice', displayName: 'Alice',
  avatar: '', avatarStatic: '', note: '<p>bio</p>', followersCount: 10, followingCount: 20, statusesCount: 30,
  header: '', headerStatic: '',
} as unknown as Account

async function mount(account: Account | null): Promise<CaribouProfileHeader> {
  const el = document.createElement('caribou-profile-header') as CaribouProfileHeader
  el.account = account
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('<caribou-profile-header>', () => {
  afterEach(() => { document.body.replaceChildren() })

  it('renders avatar, display name, handle, bio, counts', async () => {
    const el = await mount(ACCOUNT)
    const root = el.shadowRoot!
    expect(root.querySelector('img.avatar')).not.toBeNull()
    expect(root.querySelector('.name')?.textContent).toBe('Alice')
    expect(root.querySelector('.handle')?.textContent).toBe('@alice@example.social')
    expect(root.querySelector('.bio')?.innerHTML).toContain('<p>bio</p>')
    const counts = [...root.querySelectorAll('.counts span')].map((s) => s.textContent?.trim())
    expect(counts).toEqual(['30 Posts', '20 Following', '10 Followers'])
  })

  it('falls back to the username when there is no display name', async () => {
    const el = await mount({ ...ACCOUNT, displayName: '' })
    expect(el.shadowRoot!.querySelector('.name')?.textContent).toBe('alice')
  })

  it('sanitizes the bio on the client', async () => {
    const el = await mount({ ...ACCOUNT, note: '<p onclick="alert(1)">bio</p>' })
    const p = el.shadowRoot!.querySelector('.bio p')!
    expect(p.textContent).toBe('bio')
    expect(p.hasAttribute('onclick')).toBe(false)
  })

  it('paints the banner image only when the account has one', async () => {
    const plain = await mount(ACCOUNT)
    expect(plain.shadowRoot!.querySelector('.banner')?.getAttribute('style')).toBeNull()
    const withBanner = await mount({ ...ACCOUNT, headerStatic: 'https://example.social/banner.png' })
    expect(withBanner.shadowRoot!.querySelector('.banner')?.getAttribute('style'))
      .toContain('url("https://example.social/banner.png")')
  })

  it('renders nothing until it has an account', async () => {
    const el = await mount(null)
    expect(el.shadowRoot!.querySelector('.row')).toBeNull()
  })
})
