// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import type { Account } from '@beatzball/caribou-mastodon-client'
import { ssr } from './_ssr.js'
import '../../components/caribou-profile-header.js'
import '../../components/caribou-profile-tabs.js'

const ACCOUNT = {
  id: '42', acct: 'alice@example.social', username: 'alice', displayName: 'Alice',
  avatar: 'https://example.social/a.png', avatarStatic: 'https://example.social/a-static.png',
  note: '<p>bio</p>', followersCount: 10, followingCount: 20, statusesCount: 30,
  header: '', headerStatic: '',
} as unknown as Account

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
