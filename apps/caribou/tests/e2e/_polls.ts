// Mocks shared by polls.spec.ts and polls.mobile.spec.ts: a home timeline
// whose posts carry polls, and a fake poll endpoint that counts votes.
import { type Page } from './_fixtures.js'
import { API, BOB, CAROL, INSTANCE, gotoSettled, json, status } from './_moderation.js'

export { API, BOB, INSTANCE, gotoSettled, json }

export interface PollJson {
  id: string
  expires_at: string | null
  expired: boolean
  multiple: boolean
  votes_count: number
  voters_count: number | null
  voted?: boolean
  own_votes?: number[]
  options: { title: string; votes_count: number | null }[]
  emojis: unknown[]
}

export function poll(id: string, over: Partial<PollJson> = {}): PollJson {
  return {
    id, expires_at: '2099-01-01T00:00:00.000Z', expired: false, multiple: false,
    votes_count: 4, voters_count: 4, voted: false, own_votes: [], emojis: [],
    options: [{ title: 'Tea', votes_count: 3 }, { title: 'Coffee', votes_count: 1 }, { title: 'Water', votes_count: 0 }],
    ...over,
  }
}

export function pollPost(id: string, p: PollJson) {
  return { ...status(id, BOB), content: `<p>question ${id}</p>`, poll: p }
}

export function boostOf(id: string, post: ReturnType<typeof pollPost>) {
  return { ...status(id, CAROL), content: '', poll: null, reblog: post }
}

export interface FakePolls {
  /** The body of every vote, by poll id, in order. */
  votes: { id: string; choices: number[] }[]
  /** Poll reads, by poll id. */
  reads: string[]
  /** Set to make the next votes fail with a 500. */
  fail: boolean
}

export async function pollServer(page: Page, timeline: unknown[], polls: PollJson[]): Promise<FakePolls> {
  const s: FakePolls = { votes: [], reads: [], fail: false }
  const byId = new Map(polls.map((p) => [p.id, p]))
  await page.route(`${API}/v1/timelines/home*`, (route) => {
    const q = new URL(route.request().url()).searchParams
    return route.fulfill(json(q.has('max_id') || q.has('since_id') ? [] : timeline))
  })
  await page.route(new RegExp(`${API.replace(/\./g, '\\.')}/v1/polls/[^/]+(/votes)?$`), (route) => {
    const req = route.request()
    const [, id, votes] = /\/polls\/([^/]+)(\/votes)?$/.exec(new URL(req.url()).pathname)!
    const p = byId.get(id!)
    if (!p) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Record not found"}' })
    if (req.method() === 'GET' && !votes) {
      s.reads.push(id!)
      return route.fulfill(json(p))
    }
    if (req.method() === 'POST' && votes) {
      const { choices } = req.postDataJSON() as { choices: number[] }
      s.votes.push({ id: id!, choices })
      if (s.fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
      const next: PollJson = {
        ...p, voted: true, own_votes: choices,
        votes_count: p.votes_count + choices.length,
        voters_count: p.voters_count === null ? null : p.voters_count + 1,
        options: p.options.map((o, i) => ({
          ...o, votes_count: o.votes_count === null ? null : o.votes_count + (choices.includes(i) ? 1 : 0),
        })),
      }
      byId.set(id!, next)
      return route.fulfill(json(next))
    }
    return route.continue()
  })
  await page.route(`${API}/v2/instance`, (route) => route.fulfill(json({
    domain: INSTANCE,
    configuration: {
      statuses: { max_characters: 500, max_media_attachments: 4 }, media_attachments: {},
      polls: { max_options: 4, max_characters_per_option: 50, min_expiration: 300, max_expiration: 2629746 },
    },
  })))
  return s
}

export const pollIn = (page: Page, statusId: string) =>
  page.locator(`caribou-status-card[data-status-id="${statusId}"] caribou-status-poll`)
