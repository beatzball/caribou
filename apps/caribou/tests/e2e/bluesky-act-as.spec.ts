import { expect, test, type Page } from '@playwright/test'
import { ALICE, BOB, installFixtureAuth, loopbackOrigin, type XrpcAnswer, waitForSignedInHome } from './_bluesky-auth.js'

// "Act as another account" (#197; app README, "Act as another account").
// Two Bluesky accounts sign in through the real SDK. Bob is active; the
// reader likes a post as Alice. The write must carry Alice's token and
// name Alice's repo, and Bob's card must not change.

const CID = 'bafyreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm'
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
const COVERED = { 'atproto-content-labelers': `${BSKY_LABELER};redact` }
const AUTHOR = 'did:plc:erinnnnnnnnnnnnnnnnnnnnn'
const POST = `at://${AUTHOR}/app.bsky.feed.post/3lopenpost1`

function postView() {
  return {
    $type: 'app.bsky.feed.defs#postView',
    uri: POST, cid: CID,
    author: { did: AUTHOR, handle: 'erin.example.com', displayName: 'Erin', labels: [] },
    record: { $type: 'app.bsky.feed.post', createdAt: '2026-11-05T09:30:00.000Z', text: 'open post' },
    replyCount: 0, repostCount: 0, likeCount: 7, quoteCount: 0,
    indexedAt: '2026-11-05T09:30:00.500Z', viewer: {}, labels: [],
  }
}

interface Create { authorization: string | null; repo: string; collection: string; record: Record<string, unknown> }

function fixturePds(creates: Create[], auth: () => { pdsCalls: { method: string; authorization: string | null }[] }): XrpcAnswer {
  let n = 0
  return (method, url, body) => {
    switch (method) {
      case 'app.bsky.notification.listNotifications':
        return { body: url.searchParams.get('cursor') ? { notifications: [] } : { notifications: [{
          uri: POST, cid: CID, reason: 'mention', isRead: true, indexedAt: '2026-11-05T09:30:00.500Z', labels: [],
          author: postView().author, record: postView().record,
        }] }, headers: COVERED }
      case 'app.bsky.notification.getUnreadCount': return { body: { count: 0 } }
      case 'app.bsky.notification.updateSeen': return { body: {} }
      case 'app.bsky.feed.getPosts': return { body: { posts: [postView()] }, headers: COVERED }
      case 'com.atproto.repo.createRecord': {
        const b = JSON.parse(body ?? '{}') as Omit<Create, 'authorization'>
        // The fixture records the call before it asks for the answer.
        const calls = auth().pdsCalls
        creates.push({ ...b, authorization: calls[calls.length - 1]?.authorization ?? null })
        return { body: { uri: `at://${b.repo}/${b.collection}/3lnewrec${++n}aa`, cid: CID } }
      }
      case 'app.bsky.labeler.getServices':
        return { body: { views: [{
          $type: 'app.bsky.labeler.defs#labelerViewDetailed',
          uri: `at://${BSKY_LABELER}/app.bsky.labeler.service/self`, cid: CID,
          creator: { did: BSKY_LABELER, handle: 'moderation.bsky.app', labels: [] },
          policies: { labelValues: [] }, indexedAt: '2026-01-01T00:00:00.000Z', labels: [],
        }] } }
      default: return undefined
    }
  }
}

async function signIn(page: Page, origin: string, handle: string, path: string) {
  await page.goto(`${origin}${path}`)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill(handle)
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
  await waitForSignedInHome(page, origin)
  await page.waitForLoadState('networkidle')
}

test.describe('Act as another Bluesky account', () => {
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  test('a like as Alice, with Bob active, carries Alice token and repo; Bob card does not change', async ({ page, baseURL }) => {
    const origin = loopbackOrigin(baseURL)
    const creates: Create[] = []
    let state: { pdsCalls: { method: string; authorization: string | null }[] } = { pdsCalls: [] }
    state = await installFixtureAuth(page, { xrpc: fixturePds(creates, () => state) })
    await signIn(page, origin, 'alice.example.com', '/')
    await signIn(page, origin, 'bob.example.com', '/?add')
    await page.getByRole('link', { name: 'Notifications' }).click()
    await page.waitForURL(`${origin}/notifications`)

    const card = page.locator('caribou-status-card').filter({ hasText: 'open post' })
    await expect(card.getByRole('button', { name: 'Favourite' })).not.toHaveAttribute('aria-disabled', 'true')
    const more = card.getByRole('button', { name: 'More actions for post by @erin.example.com' })
    await more.click()
    await card.locator('[data-action="act-as"]').click()

    const dialog = page.getByRole('dialog', { name: 'Act as another account' })
    // Only Alice: Bob is the active account. Focus starts on her row.
    await expect(dialog.getByRole('listitem')).toHaveCount(1)
    await expect(dialog.getByRole('button', { name: 'Act as @alice.example.com' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Favourite as @alice.example.com' }).click()
    await expect(dialog.getByRole('status')).toHaveText('Favourited as @alice.example.com.')
    await expect(dialog.getByRole('button', { name: 'Unfavourite as @alice.example.com' })).toHaveAttribute('aria-pressed', 'true')

    expect(creates).toHaveLength(1)
    expect(creates[0]).toMatchObject({
      authorization: `DPoP access-${ALICE}-1`,
      repo: ALICE,
      collection: 'app.bsky.feed.like',
      record: { $type: 'app.bsky.feed.like', subject: { uri: POST, cid: CID } },
    })

    // Escape closes it, and focus goes back to More.
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(more).toBeFocused()
    // Bob's view: not favourited, count as it was.
    const fav = card.locator('caribou-icon-button.favourite')
    await expect(fav).toHaveAttribute('pressed', 'false')
    await expect(fav).toHaveAttribute('count', '7')
    expect(creates.some((c) => c.repo === BOB)).toBe(false)
  })
})
