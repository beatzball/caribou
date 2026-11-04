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

const bob = { ...account, id: 'b1', username: 'bob', acct: 'bob', display_name: 'Bob Example', url: `https://${HOST}/@bob` }

function post(id, author, over = {}) {
  return {
    id, uri: `https://${HOST}/@${author.username}/${id}`, url: `https://${HOST}/@${author.username}/${id}`,
    created_at: '2024-01-01T00:00:00.000Z', account: author, content: `<p>post ${id}</p>`,
    visibility: 'public', sensitive: false, spoiler_text: '', media_attachments: [], emojis: [],
    mentions: [], tags: [], reblogs_count: 0, favourites_count: 0, replies_count: 0, language: 'en',
    ...over,
  }
}

// Posts that quote another (Mastodon 4.5), for quotes-ssr.spec.ts. The
// quoted text carries markup the server must clean.
const STATUSES = {
  'quoting-1': post('quoting-1', account, {
    content: '<p>look at this</p><p class="quote-inline">RE: <a href="https://example.social/@bob/quoted-1">link</a></p>',
    quote: { state: 'accepted', quoted_status: post('quoted-1', bob, { content: '<p onclick="bad()">the quoted words</p>' }) },
  }),
  'quoting-cw': post('quoting-cw', account, {
    quote: { state: 'accepted', quoted_status: post('quoted-cw', bob, { spoiler_text: 'Spoilers ahead', sensitive: true, content: '<p>hidden words</p>' }) },
  }),
  'quoting-pending': post('quoting-pending', account, { quote: { state: 'pending', quoted_status: null } }),
}

const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.host !== HOST) return realFetch(input, init)
  const m = /^\/api\/v1\/timelines\/tag\/([^/]+)$/.exec(url.pathname)
  if (m) return ok(tagTimeline(decodeURIComponent(m[1]), url.searchParams.get('max_id')))
  const s = /^\/api\/v1\/statuses\/([^/]+)(\/context)?$/.exec(url.pathname)
  const found = s && STATUSES[decodeURIComponent(s[1])]
  if (found) return ok(s[2] ? { ancestors: [], descendants: [] } : found)
  return new Response('{"error":"not stubbed"}', { status: 404 })
}
