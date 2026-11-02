import { expect, type Page } from './_fixtures.js'

// Shared by the grouped notifications specs: a reader on example.social,
// three people, and one post of the reader's.

export const INSTANCE = 'example.social'
const AVATAR = `https://${INSTANCE}/face.png`

function person(id: string, username: string, displayName: string) {
  return {
    id, username, acct: username, display_name: displayName,
    avatar: AVATAR, avatar_static: AVATAR,
    url: `https://${INSTANCE}/@${username}`, header: '', header_static: '', note: '',
    followers_count: 0, following_count: 0, statuses_count: 1, locked: false, bot: false,
    discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
  }
}

export const ALICE = person('a1', 'alice', 'Alice Example')
export const BOB = person('b1', 'bob', 'Bob Example')
export const CAROL = person('c1', 'carol', 'Carol Example')
/** Everyone in the favourite group, as `/api/v2/notifications/:key/accounts` sends it. */
export const EVERYONE = [ALICE, BOB, CAROL, ...Array.from({ length: 11 }, (_, i) =>
  person(`x${i}`, `fan${i}`, `Fan ${i}`))]
const ME = person('me', 'reader', 'Reader')

export function post(id: string, content: string) {
  return {
    id, uri: `https://${INSTANCE}/@reader/${id}`, url: `https://${INSTANCE}/@reader/${id}`,
    created_at: '2026-11-01T00:00:00.000Z', account: ME, content,
    visibility: 'public', sensitive: false, spoiler_text: '',
    media_attachments: [], mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 14, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false, language: 'en',
  }
}

/** A grouped page as Mastodon 4.3+ sends it. */
export const GROUPED_PAGE = {
  accounts: [ALICE, BOB, CAROL],
  statuses: [post('s1', '<p>my busy post</p>'), post('s2', '<p>hi @reader</p>')],
  notification_groups: [
    {
      group_key: 'favourite-s1-1', notifications_count: 14, type: 'favourite',
      most_recent_notification_id: '30', page_min_id: '10', page_max_id: '30',
      sample_account_ids: ['a1', 'b1'], status_id: 's1',
    },
    {
      group_key: 'ungrouped-9', notifications_count: 1, type: 'mention',
      most_recent_notification_id: '9', page_min_id: '9', page_max_id: '9',
      sample_account_ids: ['c1'], status_id: 's2',
    },
    {
      group_key: 'follow-1', notifications_count: 2, type: 'follow',
      most_recent_notification_id: '8', page_min_id: '7', page_max_id: '8',
      sample_account_ids: ['c1', 'a1'],
    },
  ],
}

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const EMPTY_GROUPED = { accounts: [], statuses: [], notification_groups: [] }

/** Answers the grouped endpoint: the first page, then nothing older or newer. */
export async function serveGrouped(page: Page, first: unknown = GROUPED_PAGE): Promise<string[]> {
  const asked: string[] = []
  await page.route('**/api/v2/notifications/*/accounts', (route) => route.fulfill({ json: EVERYONE }))
  await page.route('**/api/v2/notifications*', (route) => {
    const u = new URL(route.request().url())
    asked.push(u.search)
    const paging = u.searchParams.get('max_id') || u.searchParams.get('min_id')
    return route.fulfill({ json: paging ? EMPTY_GROUPED : first })
  })
  return asked
}

export async function openNotifications(page: Page) {
  await page.route('**/face.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }))
  await page.route('**/api/v1/timelines/home*', (route) => route.fulfill({ json: [] }))
  await page.addInitScript((key) => {
    const account = { id: 'me', username: 'reader', acct: 'reader' }
    localStorage.setItem('caribou.users', JSON.stringify([[key,
      { userKey: key, server: 'example.social', token: 'TOKEN', vapidKey: '', account, createdAt: 1 }]]))
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(key))
  }, `reader@${INSTANCE}`)
  await page.goto('/notifications')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await expect(page.locator('litro-outlet > *')).toHaveCount(1)
  return page.locator('caribou-notifications')
}
