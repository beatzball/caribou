// Loaded into a test server with `node --import`. It answers the server's
// own requests to `example.social` with fixed data, so a spec can check what
// the server paints from an instance without a real one. Every other request
// goes out as usual. Test-only: nothing in the app loads this file.
const HOST = 'example.social'
const realFetch = globalThis.fetch

const account = {
  id: 'a1', username: 'alice', acct: 'alice', display_name: 'Alice Example',
  avatar: '', avatar_static: '', url: `https://${HOST}/@alice`, header: '', header_static: '',
  note: '', followers_count: 0, following_count: 0, statuses_count: 2, locked: false, bot: false,
  discoverable: true, created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

// Two posts per tag, with the tag in their ids and text, so a spec can tell
// one tag's list from another's. A `max_id` page is empty.
function tagTimeline(tag, maxId) {
  if (maxId) return []
  const slug = encodeURIComponent(tag.toLowerCase())
  return ['2', '1'].map((n) => ({
    id: `${slug}-${n}`, uri: `https://${HOST}/@alice/${slug}-${n}`, url: `https://${HOST}/@alice/${slug}-${n}`,
    created_at: '2024-01-01T00:00:00.000Z', account,
    content: `<p>post ${n} about <a href="https://${HOST}/tags/${slug}" class="mention hashtag" rel="tag">#<span>${tag}</span></a></p>`,
    visibility: 'public', sensitive: false, spoiler_text: '', media_attachments: [], emojis: [],
    mentions: [], tags: [{ name: tag.toLowerCase(), url: `https://${HOST}/tags/${slug}` }],
    reblogs_count: 0, favourites_count: 0, replies_count: 0, language: 'en',
  }))
}

// The local timeline: two posts with polls, as the API sends them without a
// token (no `voted`, no `own_votes`). `polls-ssr.spec.ts` reads it.
export function pollPosts() {
  const base = {
    created_at: '2024-01-01T00:00:00.000Z', account, visibility: 'public', sensitive: false,
    spoiler_text: '', media_attachments: [], emojis: [], mentions: [], tags: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0, language: 'en',
  }
  return [
    { ...base, id: 'poll-open', uri: `https://${HOST}/@alice/poll-open`, url: `https://${HOST}/@alice/poll-open`,
      content: '<p>Tea or coffee?</p>',
      poll: { id: 'p-open', expires_at: '2099-01-01T00:00:00.000Z', expired: false, multiple: false,
        votes_count: 4, voters_count: 4, emojis: [],
        options: [{ title: 'Tea 🍵', votes_count: 3 }, { title: 'Coffee', votes_count: 1 }] } },
    { ...base, id: 'poll-ended', uri: `https://${HOST}/@alice/poll-ended`, url: `https://${HOST}/@alice/poll-ended`,
      content: '<p>Pick your days</p>',
      poll: { id: 'p-ended', expires_at: '2024-01-02T00:00:00.000Z', expired: true, multiple: true,
        votes_count: 6, voters_count: 4, emojis: [],
        options: [{ title: 'Monday', votes_count: 4 }, { title: 'Friday', votes_count: 2 }] } },
  ]
}

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.host !== HOST) return realFetch(input, init)
  if (url.pathname === '/api/v1/timelines/public' && url.searchParams.get('local') === 'true') {
    const body = url.searchParams.get('max_id') ? [] : pollPosts()
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const m = /^\/api\/v1\/timelines\/tag\/([^/]+)$/.exec(url.pathname)
  if (!m) return new Response('{"error":"not stubbed"}', { status: 404 })
  const body = tagTimeline(decodeURIComponent(m[1]), url.searchParams.get('max_id'))
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}
