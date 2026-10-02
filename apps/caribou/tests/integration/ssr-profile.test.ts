// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import type { Account, Status } from '@beatzball/caribou-mastodon-client'
import { statusCache } from '@beatzball/caribou-state'
import { ssr } from './_ssr.js'
import '../../components/caribou-profile-header.js'
import '../../components/caribou-profile-tabs.js'
import '../../components/caribou-profile.js'
import type { ProfileInitial } from '../../components/caribou-profile.js'
import '../../pages/@[handle].js'
import type { HandlePageData } from '../../pages/@[handle].js'

const ACCOUNT = {
  id: '42', acct: 'alice@example.social', username: 'alice', displayName: 'Alice',
  avatar: 'https://example.social/a.png', avatarStatic: 'https://example.social/a-static.png',
  note: '<p>bio</p>', followersCount: 10, followingCount: 20, statusesCount: 30,
  header: '', headerStatic: '',
} as unknown as Account

function status(id: string): Status {
  return {
    id, content: `<p>post ${id}</p>`, account: ACCOUNT, createdAt: '2026-04-28T12:00:00Z',
  } as unknown as Status
}

const INITIAL: ProfileInitial = {
  account: ACCOUNT, statuses: [status('210'), status('209')], nextMaxId: '209', tab: 'posts',
}

// Lit wraps each binding in comment markers; drop them to read the text.
const strip = (s: string) => s.replace(/<!--[^>]*-->/g, '')

describe('caribou-profile-header SSR', () => {
  it('renders the account from a property binding', async () => {
    const out = strip(await ssr(html`<caribou-profile-header .account=${ACCOUNT}></caribou-profile-header>`))
    expect(out).toContain('<template shadowroot="open" shadowrootmode="open">')
    expect(out).toContain('<div class="name">Alice</div>')
    expect(out).toContain('<div class="handle">@alice@example.social</div>')
    expect(out).toContain('src="https://example.social/a-static.png"')
    expect(out).toContain('<strong>30</strong> Posts')
    expect(out).toContain('<strong>20</strong> Following')
    expect(out).toContain('<strong>10</strong> Followers')
  })

  it('prints the pre-sanitized bio as it is', async () => {
    const out = strip(await ssr(html`<caribou-profile-header .account=${ACCOUNT}></caribou-profile-header>`))
    expect(out).toContain('<div class="bio"><p>bio</p></div>')
  })

  it('does not write the account into an attribute', async () => {
    const out = await ssr(html`<caribou-profile-header .account=${ACCOUNT}></caribou-profile-header>`)
    expect(out).not.toMatch(/<caribou-profile-header[^>]*account=/)
  })
})

describe('caribou-profile-tabs SSR', () => {
  it('server-renders real anchors that work without JavaScript', async () => {
    const out = strip(await ssr(html`<caribou-profile-tabs handle="@alice@example.social" tab="media"></caribou-profile-tabs>`))
    expect(out).toContain('<a href="/@alice@example.social?tab=posts"')
    expect(out).toContain('<a href="/@alice@example.social?tab=replies"')
    expect(out).toMatch(/<a href="\/@alice@example\.social\?tab=media"\s+aria-current="page"/)
    expect(out.match(/<a [^>]*aria-current="page"/g)).toHaveLength(1)
  })
})

describe('caribou-profile SSR', () => {
  const render = (initial: ProfileInitial | null, tab = 'posts') => ssr(html`
    <caribou-profile handle="alice@example.social" tab=${tab} .initial=${initial}></caribou-profile>
  `).then(strip)

  it('paints the header, the tabs and every card, with no Loading flash', async () => {
    const out = await render(INITIAL)
    expect(out).toContain('<div class="name">Alice</div>')
    expect(out).toMatch(/<caribou-profile-tabs[^>]*handle="alice@example\.social"[^>]*tab="posts"/)
    expect(out.match(/<caribou-status-card\s/g)).toHaveLength(2)
    expect(out.match(/<li\b/g)).toHaveLength(2)
    expect(out).not.toContain('Loading…')
  })

  it('renders each card in order, as a timeline card that carries its status id and content', async () => {
    const out = await render(INITIAL)
    const ids = [...out.matchAll(/<caribou-status-card\s+variant="timeline"\s+data-status-id="(\d+)"/g)].map((m) => m[1])
    expect(ids).toEqual(['210', '209'])
    expect(out.indexOf('<p>post 210</p>')).toBeGreaterThan(-1)
    expect(out.indexOf('<p>post 209</p>')).toBeGreaterThan(out.indexOf('<p>post 210</p>'))
  })

  it('does not write the first page into an attribute', async () => {
    const out = await render(INITIAL)
    expect(out).not.toMatch(/<caribou-profile [^>]*initial=/)
    expect(out).not.toMatch(/<caribou-status-card[^>]*\sstatus=/)
  })

  it('links to the next page for readers without JavaScript', async () => {
    const out = await render(INITIAL)
    expect(out).toMatch(/<a href="[^"]*\?tab=posts&amp;max_id=209"\s+rel="next"\s+data-sentinel[^>]*>Older posts →<\/a>/)
  })

  it('renders no next-page link on the last page', async () => {
    const out = await render({ ...INITIAL, nextMaxId: null })
    expect(out).not.toMatch(/<a [^>]*rel="next"/)
  })

  it('renders Loading… when the server has no first page (the /@me case)', async () => {
    const out = await render(null)
    expect(out).toContain('<div class="loading">Loading…</div>')
    expect(out).not.toContain('<caribou-profile-header')
  })

  // A store on the server would write every rendered status into a
  // module-level cache that no request ever clears.
  it('leaves the shared status cache untouched', async () => {
    await render(INITIAL)
    expect(statusCache.value.size).toBe(0)
  })
})

describe('/@[handle] page SSR', () => {
  const shell = { instance: 'example.social' }
  const render = (data: HandlePageData) =>
    ssr(html`<page-handle .serverData=${data}></page-handle>`).then(strip)

  it('hands the fetched profile to caribou-profile, which renders it', async () => {
    const out = await render({ kind: 'ok', ...INITIAL, shell, handle: 'alice@example.social' })
    expect(out).toMatch(/<caribou-app-shell[^>]*instance="example\.social"/)
    expect(out).toMatch(/<caribou-profile[^>]*handle="alice@example\.social"[^>]*tab="posts"/)
    expect(out).toContain('<div class="name">Alice</div>')
    expect(out.match(/<caribou-status-card\s/g)).toHaveLength(2)
    expect(out).toContain('<p>post 210</p>')
    expect(out).not.toContain('Loading…')
  })

  it('renders the sign-in placeholder for /@me', async () => {
    const out = await render({ kind: 'auth-required', shell, handle: 'me' })
    expect(out).toContain('Your profile shows posts from your signed-in account.')
    expect(out).not.toContain('<caribou-profile ')
  })

  it('renders the instance placeholder for a bare handle with no instance', async () => {
    const out = await render({ kind: 'auth-required', shell: { instance: null }, handle: 'alice' })
    expect(out).toContain('Profiles by bare handle (@user without @host) need to know which instance to query.')
  })

  it('renders an alert when the lookup failed', async () => {
    const out = await render({ kind: 'error', message: 'Error: 404', shell, handle: 'nobody@example.social' })
    expect(out).toMatch(/<article role="alert">\s*Couldn't load profile @nobody@example\.social\.\s*<\/article>/)
    expect(out).not.toContain('Error: 404')
  })
})
