// Loaded into the test server with `node --import` (remote-profile-refused
// spec). It stands in for a Mastodon server that refuses Caribou's server:
// `refuses.example` answers the account lookup but a 401 for the posts, as
// a real server did. Every other request goes to the real fetch, so this
// changes nothing else. The server never reaches the network for this host.

const HOST = 'https://refuses.example/'

const ACCOUNT = {
  id: 'path-7', username: 'carol', acct: 'carol', display_name: 'Carol Path',
  url: 'https://refuses.example/@carol', avatar: '', avatar_static: '',
  header: '', header_static: '', note: '', locked: true, bot: false,
  followers_count: 0, following_count: 0, statuses_count: 0,
  created_at: '2024-01-01T00:00:00.000Z', fields: [], emojis: [],
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
})

const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith(HOST)) return realFetch(input, init)
  const { pathname } = new URL(url)
  if (pathname === '/api/v1/accounts/lookup') return json(200, ACCOUNT)
  return json(401, { error: 'This method requires an authenticated user' })
}
