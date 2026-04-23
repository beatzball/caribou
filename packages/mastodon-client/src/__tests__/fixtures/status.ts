export const sampleAccount = {
  id: 'acct-1',
  username: 'beatzball',
  acct: 'beatzball',
  display_name: 'Beatz Ball',
  url: 'https://fosstodon.org/@beatzball',
  avatar: 'https://fosstodon.org/avatars/beatzball.png',
  avatar_static: 'https://fosstodon.org/avatars/beatzball.png',
  header: '', header_static: '', note: '',
  followers_count: 0, following_count: 0, statuses_count: 1,
  locked: false, bot: false, discoverable: true,
  created_at: '2024-01-01T00:00:00.000Z',
  fields: [], emojis: [],
}

export function makeStatus(id: string, content = `<p>post ${id}</p>`) {
  return {
    id,
    uri: `https://fosstodon.org/@beatzball/${id}`,
    url: `https://fosstodon.org/@beatzball/${id}`,
    created_at: '2024-01-01T00:00:00.000Z',
    account: sampleAccount,
    content,
    visibility: 'public',
    sensitive: false,
    spoiler_text: '',
    media_attachments: [],
    mentions: [], tags: [], emojis: [],
    reblogs_count: 0, favourites_count: 0, replies_count: 0,
    favourited: false, reblogged: false, bookmarked: false,
    language: 'en',
  }
}
