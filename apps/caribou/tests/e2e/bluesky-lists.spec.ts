import { expect, test, type Page } from '@playwright/test'
import { ALICE, installFixtureAuth, loopbackOrigin, type XrpcAnswer } from './_bluesky-auth.js'

// Bluesky lists through the real SDK and a fixture PDS (#195): the New list
// dialog says lists are public, Create writes one curate list record, the
// list's page reads its feed, and Delete removes the record.

// The SDK checks every answer against the lexicon, so the CIDs are real ones.
const CID = 'bafyreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm'
const LIST = 'app.bsky.graph.list'
const NOTE = 'Bluesky lists are public. Anyone can see the list\'s name and who is in it.'

interface Pds {
  records: Map<string, { uri: string; cid: string; value: Record<string, unknown> }>
  creates: { collection: string; rkey?: string; record: Record<string, unknown> }[]
  writes: { collection: string; rkey: string }[][]
  listFeeds: string[]
  answer: XrpcAnswer
}

function fixturePds(): Pds {
  const pds: Pds = {
    records: new Map(),
    creates: [],
    writes: [],
    listFeeds: [],
    answer: (method, url, body) => {
      switch (method) {
        case 'app.bsky.notification.getUnreadCount':
          return { body: { count: 0 } }
        case 'app.bsky.feed.getTimeline':
          return { body: { feed: [] } }
        case 'com.atproto.repo.listRecords': {
          const collection = url.searchParams.get('collection')
          return { body: { records: [...pds.records.values()].filter((r) => r.uri.split('/')[3] === collection) } }
        }
        case 'com.atproto.repo.getRecord': {
          const rec = pds.records.get(`${url.searchParams.get('collection')}/${url.searchParams.get('rkey')}`)
          return rec ? { body: rec } : { status: 400, body: { error: 'RecordNotFound', message: 'Could not locate record' } }
        }
        case 'com.atproto.repo.createRecord': {
          const b = JSON.parse(body ?? '{}') as { repo: string; collection: string; rkey?: string; record: Record<string, unknown> }
          pds.creates.push({ collection: b.collection, ...(b.rkey ? { rkey: b.rkey } : {}), record: b.record })
          const uri = `at://${b.repo}/${b.collection}/${b.rkey}`
          pds.records.set(`${b.collection}/${b.rkey}`, { uri, cid: CID, value: b.record })
          return { body: { uri, cid: CID } }
        }
        case 'com.atproto.repo.applyWrites': {
          const b = JSON.parse(body ?? '{}') as { writes: { collection: string; rkey: string }[] }
          pds.writes.push(b.writes.map((w) => ({ collection: w.collection, rkey: w.rkey })))
          for (const w of b.writes) pds.records.delete(`${w.collection}/${w.rkey}`)
          return { body: {} }
        }
        case 'app.bsky.feed.getListFeed':
          pds.listFeeds.push(url.searchParams.get('list') ?? '')
          return { body: { feed: [] } }
        default:
          return undefined
      }
    },
  }
  return pds
}

async function signIn(page: Page, origin: string) {
  await page.goto(`${origin}/`)
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.getByRole('tab', { name: 'Bluesky' }).click()
  await page.getByLabel('Bluesky handle').fill('alice.example.com')
  await page.getByRole('tabpanel', { name: 'Bluesky' }).getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${origin}/home`)
}

test.describe('Bluesky lists', () => {
  // As in bluesky-signin.spec.ts: Playwright WebKit on macOS hangs storing
  // the SDK's DPoP key in IndexedDB. CI runs WebKit on Linux.
  test.skip(({ browserName }) => browserName === 'webkit' && process.platform === 'darwin',
    'Playwright WebKit on macOS hangs storing a CryptoKey in IndexedDB')

  test('New list says lists are public, makes one curate list, and Delete removes it', async ({ page, baseURL }) => {
    const pds = fixturePds()
    await installFixtureAuth(page, { xrpc: pds.answer })
    const origin = loopbackOrigin(baseURL)
    await signIn(page, origin)
    await page.goto(`${origin}/lists`)
    await expect(page.getByText('No lists yet.')).toContainText(NOTE)

    await page.getByRole('button', { name: 'New list' }).click()
    const dialog = page.getByRole('dialog', { name: 'New list' })
    await expect(dialog).toContainText(NOTE)
    const title = dialog.getByRole('textbox', { name: 'Title' })
    await expect(title).toHaveAccessibleDescription(NOTE)
    // Bluesky lists have no replies policy.
    await expect(dialog.getByRole('radio')).toHaveCount(0)
    await title.fill('Cats')
    await dialog.getByRole('button', { name: 'Create' }).click()

    const link = page.getByRole('link', { name: 'Cats' })
    await expect(link).toBeVisible()
    expect(pds.creates).toHaveLength(1)
    expect(pds.creates[0]).toMatchObject({
      collection: LIST, rkey: expect.stringMatching(/^[2-7a-z]{13}$/),
      record: { $type: LIST, name: 'Cats', purpose: 'app.bsky.graph.defs#curatelist' },
    })
    const rkey = pds.creates[0]!.rkey!

    await link.click()
    await page.waitForURL(`${origin}/lists/${rkey}`)
    await expect(page.getByRole('heading', { name: 'Cats' })).toBeVisible()
    await expect.poll(() => pds.listFeeds).toContain(`at://${ALICE}/${LIST}/${rkey}`)

    await page.goto(`${origin}/lists`)
    await page.getByRole('button', { name: 'Delete Cats' }).click()
    await page.getByRole('dialog', { name: 'Delete "Cats"?' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('link', { name: 'Cats' })).toHaveCount(0)
    await expect.poll(() => pds.writes).toEqual([[{ collection: LIST, rkey }]])
  })
})
