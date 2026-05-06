import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => { await import('../caribou-status-card.js') })

const REBLOG_STATUS = {
  id: 'wrapper',
  content: '',
  account: { id: '99', acct: 'booster', username: 'booster', displayName: 'Booster',
             avatar: '', avatarStatic: '' },
  createdAt: '2026-04-28T12:00:00Z',
  reblog: {
    id: 'inner',
    content: '<p>boosted content</p>',
    account: { id: '42', acct: 'alice', username: 'alice', displayName: 'Alice',
               avatar: '', avatarStatic: '' },
    createdAt: '2026-04-28T11:00:00Z',
  },
}

describe('<caribou-status-card> boost rendering', () => {
  it.each(['timeline', 'focused', 'ancestor', 'descendant'] as const)
    ('variant=%s renders reblog content with attribution row', async (v) => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-status-card') as HTMLElement & { status: unknown; variant: string }
    el.variant = v
    el.status = REBLOG_STATUS
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.textContent).toContain('boosted content')
    expect(el.shadowRoot!.textContent).toContain('Alice')
    expect(el.shadowRoot!.textContent).toContain('Booster')
    expect(el.shadowRoot!.querySelector('.boost-attribution')).toBeTruthy()
    expect(el.shadowRoot!.querySelector('.boost-attribution svg')).toBeTruthy()
    // Permalink targets the inner reblog (alice/inner), not the wrapper
    // (booster/wrapper) — clicking through a boost should land on the
    // boosted post's thread page.
    const permalink = el.shadowRoot!.querySelector<HTMLAnchorElement>('a.permalink')
    expect(permalink?.getAttribute('href')).toBe('/@alice/inner')
    expect(permalink?.querySelector('time')).toBeTruthy()
  })

  it('non-reblog status does NOT render attribution row', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-status-card') as HTMLElement & { status: unknown; variant: string }
    el.variant = 'timeline'
    el.status = {
      id: '1',
      content: '<p>plain</p>',
      account: { id: '1', acct: 'a', username: 'a', displayName: 'A', avatar: '', avatarStatic: '' },
      createdAt: '2026-04-28T12:00:00Z',
    }
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.querySelector('.boost-attribution')).toBeFalsy()
    const permalink = el.shadowRoot!.querySelector<HTMLAnchorElement>('a.permalink')
    expect(permalink?.getAttribute('href')).toBe('/@a/1')
  })

  it('federated post uses the home-instance id (not origin id) in the permalink', async () => {
    // The route resolver fetches from the cookie host (home) — never from
    // the path host — because status ids are minted per-instance and only
    // home recognizes the id we have here. So the permalink encodes home's
    // id verbatim; the handle's `@host` is for display + share-context.
    document.body.innerHTML = ''
    const el = document.createElement('caribou-status-card') as HTMLElement & { status: unknown; variant: string }
    el.variant = 'timeline'
    el.status = {
      id: '116527525773628717',
      url: 'https://bildung.social/@oerinfo/116527480439295750',
      content: '<p>federated</p>',
      account: { id: '7', acct: 'oerinfo@bildung.social', username: 'oerinfo',
                 displayName: 'OER', avatar: '', avatarStatic: '' },
      createdAt: '2026-04-28T12:00:00Z',
    }
    document.body.appendChild(el)
    await Promise.resolve()
    const permalink = el.shadowRoot!.querySelector<HTMLAnchorElement>('a.permalink')
    expect(permalink?.getAttribute('href'))
      .toBe('/@oerinfo@bildung.social/116527525773628717')
    expect(permalink?.getAttribute('target')).toBeNull()
  })

  it('encodes ids with unsafe characters (non-Mastodon ActivityPub bridges)', async () => {
    // Some bridges (Flipboard, etc.) produce ids that contain `/` or `:`.
    // The path must round-trip safely: encodeURIComponent on render, the
    // page decodes via decodeURIComponent.
    document.body.innerHTML = ''
    const el = document.createElement('caribou-status-card') as HTMLElement & { status: unknown; variant: string }
    el.variant = 'timeline'
    el.status = {
      id: 'a-KG-G6ylKSNW1-Fu18u5PnA:a:2586892611-/0',
      url: 'https://flipboard.com/@smithsonianmag/a-KG-G6ylKSNW1-Fu18u5PnA:a:2586892611-/0',
      content: '<p>flipboard-bridged</p>',
      account: { id: '8', acct: 'smithsonianmag@flipboard.com',
                 username: 'smithsonianmag', displayName: 'Smithsonian',
                 avatar: '', avatarStatic: '' },
      createdAt: '2026-04-28T12:00:00Z',
    }
    document.body.appendChild(el)
    await Promise.resolve()
    const permalink = el.shadowRoot!.querySelector<HTMLAnchorElement>('a.permalink')
    expect(permalink?.getAttribute('href'))
      .toBe('/@smithsonianmag@flipboard.com/a-KG-G6ylKSNW1-Fu18u5PnA%3Aa%3A2586892611-%2F0')
  })
})
