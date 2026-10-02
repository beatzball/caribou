import { beforeEach, describe, expect, it } from 'vitest'
import '../caribou-status-card.js'
import type { CaribouStatusCard, StatusCardVariant } from '../caribou-status-card.js'

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

// Fixtures leave out the long tail of Status fields the card never reads.
async function mount(status: unknown, variant: StatusCardVariant = 'timeline'): Promise<CaribouStatusCard> {
  const el = document.createElement('caribou-status-card') as CaribouStatusCard
  el.variant = variant
  el.status = status as CaribouStatusCard['status']
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('<caribou-status-card> boost rendering', () => {
  beforeEach(() => { document.body.replaceChildren() })

  it.each(['timeline', 'focused', 'ancestor', 'descendant'] as const)
    ('variant=%s renders reblog content with attribution row', async (v) => {
    const el = await mount(REBLOG_STATUS, v)
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
    const el = await mount({
      id: '1',
      content: '<p>plain</p>',
      account: { id: '1', acct: 'a', username: 'a', displayName: 'A', avatar: '', avatarStatic: '' },
      createdAt: '2026-04-28T12:00:00Z',
    })
    expect(el.shadowRoot!.querySelector('.boost-attribution')).toBeFalsy()
    const permalink = el.shadowRoot!.querySelector<HTMLAnchorElement>('a.permalink')
    expect(permalink?.getAttribute('href')).toBe('/@a/1')
  })

  it('federated post uses the home-instance id (not origin id) in the permalink', async () => {
    // The route resolver fetches from the cookie host (home) — never from
    // the path host — because status ids are minted per-instance and only
    // home recognizes the id we have here. So the permalink encodes home's
    // id verbatim; the handle's `@host` is for display + share-context.
    const el = await mount({
      id: '116527525773628717',
      url: 'https://remote.example/@carol/116527480439295750',
      content: '<p>federated</p>',
      account: { id: '7', acct: 'carol@remote.example', username: 'carol',
                 displayName: 'Carol', avatar: '', avatarStatic: '' },
      createdAt: '2026-04-28T12:00:00Z',
    })
    const permalink = el.shadowRoot!.querySelector<HTMLAnchorElement>('a.permalink')
    expect(permalink?.getAttribute('href'))
      .toBe('/@carol@remote.example/116527525773628717')
    expect(permalink?.getAttribute('target')).toBeNull()
  })

  it('encodes ids with unsafe characters (non-Mastodon ActivityPub bridges)', async () => {
    // Some bridges produce ids that contain `/` or `:`. The path must
    // round-trip safely: encodeURIComponent on render, the page decodes via
    // decodeURIComponent.
    const el = await mount({
      id: 'a-KG-G6ylKSNW1-Fu18u5PnA:a:2586892611-/0',
      url: 'https://bridge.example/@magazine/a-KG-G6ylKSNW1-Fu18u5PnA:a:2586892611-/0',
      content: '<p>bridged</p>',
      account: { id: '8', acct: 'magazine@bridge.example',
                 username: 'magazine', displayName: 'Magazine',
                 avatar: '', avatarStatic: '' },
      createdAt: '2026-04-28T12:00:00Z',
    })
    const permalink = el.shadowRoot!.querySelector<HTMLAnchorElement>('a.permalink')
    expect(permalink?.getAttribute('href'))
      .toBe('/@magazine@bridge.example/a-KG-G6ylKSNW1-Fu18u5PnA%3Aa%3A2586892611-%2F0')
  })
})
