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

  it('federated Mastodon status uses origin host + origin id from status.url', async () => {
    // Cross-instance ID hazard: in our home timeline, `status.id` is the
    // home instance's local id, but querying the origin instance with that
    // id 404s. The permalink must derive host + id from `status.url` so
    // the route resolver hits origin with origin's own id.
    document.body.innerHTML = ''
    const el = document.createElement('caribou-status-card') as HTMLElement & { status: unknown; variant: string }
    el.variant = 'timeline'
    el.status = {
      id: 'HOME_LOCAL_ID',
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
      .toBe('/@oerinfo@bildung.social/116527480439295750')
    expect(permalink?.getAttribute('target')).toBeNull()
  })

  it('non-Mastodon origin (Flipboard etc.) links externally to status.url', async () => {
    // Flipboard, Misskey, Pleroma all federate via ActivityPub but their
    // URL shapes (and REST APIs) differ from Mastodon's. Internal routing
    // would 404 because we'd try to query their host as if it spoke
    // Mastodon REST. Link out instead.
    document.body.innerHTML = ''
    const el = document.createElement('caribou-status-card') as HTMLElement & { status: unknown; variant: string }
    el.variant = 'timeline'
    el.status = {
      id: 'a-KG-G6ylKSNW1-Fu18u5PnA:a:2586892611-/0',
      url: 'https://flipboard.com/@smithsonianmag/a-KG-G6ylKSNW1-Fu18u5PnA:a:2586892611-/0',
      content: '<p>federated from Flipboard</p>',
      account: { id: '8', acct: 'smithsonianmag@flipboard.com',
                 username: 'smithsonianmag', displayName: 'Smithsonian',
                 avatar: '', avatarStatic: '' },
      createdAt: '2026-04-28T12:00:00Z',
    }
    document.body.appendChild(el)
    await Promise.resolve()
    const permalink = el.shadowRoot!.querySelector<HTMLAnchorElement>('a.permalink')
    expect(permalink?.getAttribute('href'))
      .toBe('https://flipboard.com/@smithsonianmag/a-KG-G6ylKSNW1-Fu18u5PnA:a:2586892611-/0')
    expect(permalink?.getAttribute('target')).toBe('_blank')
    expect(permalink?.getAttribute('rel')).toBe('noopener')
  })
})
