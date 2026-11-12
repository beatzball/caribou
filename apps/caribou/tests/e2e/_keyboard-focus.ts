import { expect, type Page } from './_fixtures.js'
import type { CaribouTimeline } from '../../components/caribou-timeline.js'
import type { Status } from '@beatzball/caribou-mastodon-client'

export const account = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: '', avatar_static: '', url: 'https://example.social/@alice',
  header: '', header_static: '', note: '', followers_count: 0, following_count: 0,
  statuses_count: 1, locked: false, bot: false, discoverable: true,
  created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}
export const status = (id: string) => ({
  id, uri: `https://example.social/@alice/${id}`, url: `https://example.social/@alice/${id}`,
  created_at: '2024-01-01T00:00:00.000Z', account, content: `<p>post ${id}</p>`,
  visibility: 'public', sensitive: false, spoiler_text: id === '19' ? 'A warning' : '',
  media_attachments: [], mentions: [], tags: [], emojis: [],
  reblogs_count: 0, favourites_count: 0, replies_count: 0,
  favourited: false, reblogged: false, bookmarked: false, language: 'en',
  ...(id === '18' ? { filtered: [{ filter: {
    id: 'f1', title: 'A filter', context: ['home'], filter_action: 'warn', expires_at: null,
  }, keyword_matches: ['post'], status_matches: [] }] } : {}),
})
export async function seed(page: Page, theme: string) {
  await page.addInitScript(({ account, theme }) => {
    const session = { userKey: 'alice@example.social', server: 'example.social', token: 'TOKEN',
      vapidKey: '', account, createdAt: 1 }
    localStorage.setItem('caribou.users', JSON.stringify([[session.userKey, session]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(session.userKey))
    localStorage.setItem('caribou.prefs.alice@example.social', JSON.stringify({ theme }))
  }, { account, theme })
  await page.route('**/api/v2/instance', (route) => route.fulfill({ json: {
    domain: 'example.social', configuration: { statuses: { max_characters: 500, max_media_attachments: 4 } },
  } }))
}
export async function settled(page: Page, path = '/home') {
  await page.goto(path)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
}
export function deepFocus(page: Page) {
  return page.evaluate(() => {
    let el = document.activeElement
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
    return { tag: el?.localName, id: el?.id, text: el?.textContent,
      connected: el?.isConnected, visible: el instanceof HTMLElement && el.getBoundingClientRect().height > 0 }
  })
}
export async function phoneFocus(page: Page, browserName: string, theme: string, network = 'mastodon') {
  await page.setViewportSize({ width: 393, height: 700 })
  await seed(page, theme)
  await page.route('**/api/v1/timelines/home*', (route) => {
    const u = new URL(route.request().url())
    return route.fulfill({ json: u.searchParams.has('max_id') || u.searchParams.has('since_id')
      ? [] : Array.from({ length: 20 }, (_, i) => status(String(20 - i))) })
  })
  await settled(page)
  if (network === 'bluesky') {
    // Render mapped public Bluesky posts in the real shared shell. No SDK
    // storage is needed for this geometry fixture, including macOS WebKit.
    await page.locator('caribou-app-shell').evaluate((shell) => {
      const timeline = document.createElement('caribou-timeline') as CaribouTimeline
      timeline.kind = 'bookmarks' // A fresh store, separate from the signed-in Home fixture.
      const ui = { filter: false, blur: false, alert: false, inform: false, noOverride: false, reasons: [] }
      const contexts = Object.fromEntries(['contentList', 'contentView', 'contentMedia', 'avatar', 'banner', 'profileList', 'profileView'].map((key) => [key, ui]))
      timeline.initial = { nextCursor: null, statuses: Array.from({ length: 20 }, (_, i) => {
        const uri = `at://did:plc:bob/app.bsky.feed.post/p${i}`
        return {
          id: uri, uri, network: 'bluesky', createdAt: '2024-01-01T00:00:00.000Z', content: `<p>Bluesky post ${i}</p>`,
          account: { id: 'did:plc:bob', acct: 'bob.example.com', username: 'bob.example.com', displayName: 'Bob', avatar: '', avatarStatic: '' },
          bluesky: { uri, cid: 'bafkexample', viewerOf: null, labels: [], likeUri: null, repostUri: null,
            replyRef: null, replyDisabled: false, embeddingDisabled: false, moderation: { contexts, labelersCovered: [] } },
          visibility: 'public', spoilerText: '', mediaAttachments: [], mentions: [], tags: [], emojis: [],
          reblogsCount: 0, favouritesCount: 0, repliesCount: 0,
        } as unknown as Status
      }) }
      shell.replaceChildren(timeline)
    })
  }
  await expect(page.locator('caribou-status-card')).toHaveCount(20)
  if (network === 'bluesky') await expect(page.locator('caribou-status-card').first()).toContainText('Bluesky post 0')
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await page.locator('litro-outlet').focus()
  let reached = 0
  for (let i = 0; i < 110; i++) {
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
    const result = await page.locator('caribou-timeline').evaluate((tl) => {
      let active = document.activeElement
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
      if (!active || !tl.shadowRoot?.contains(tl.shadowRoot.activeElement)) return null
      const rect = active.getBoundingClientRect()
      const bar = tl.closest('caribou-app-shell')!.shadowRoot!.querySelector('caribou-nav-rail')!
        .shadowRoot!.querySelector('nav')!.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, bar: bar.top, tag: active.localName }
    })
    if (!result) continue
    reached++
    expect(result.top, JSON.stringify(result)).toBeLessThan(result.bar)
    expect(result.bottom, JSON.stringify(result)).toBeGreaterThan(0)
  }
  expect(reached).toBeGreaterThan(40)
}
