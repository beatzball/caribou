// Phase-0 spike (#170). Reference only; never merged.
// The page loads this module with one dynamic import(), so both atproto
// libraries land in one lazy chunk that Mastodon-only readers never fetch.
import { Agent } from '@atproto/api'
import { BrowserOAuthClient } from '@atproto/oauth-client-browser'

const SCOPE = 'atproto transition:generic'

function loopbackClientId(): string {
  // The loopback client must run on 127.0.0.1, not localhost (the SDK
  // redirects there). The redirect_uri is this page.
  const { port, pathname } = window.location
  const redirectUri = `http://127.0.0.1${port ? `:${port}` : ''}${pathname}`
  return `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(SCOPE)}`
}

let client: BrowserOAuthClient | undefined

async function getClient(): Promise<BrowserOAuthClient> {
  client ??= await BrowserOAuthClient.load({
    clientId: loopbackClientId(),
    handleResolver: 'https://bsky.social',
  })
  return client
}

export interface FollowingItem { handle: string; text: string; reposted: boolean }

/** Runs on page load: finishes a callback or restores a stored session. */
export async function initSession(): Promise<{ did: string } | null> {
  const result = await (await getClient()).init()
  return result ? { did: result.session.sub } : null
}

export async function signIn(handle: string): Promise<void> {
  await (await getClient()).signIn(handle, { scope: SCOPE })
}

export async function fetchFollowing(did: string): Promise<FollowingItem[]> {
  const session = await (await getClient()).restore(did)
  const agent = new Agent(session)
  const res = await agent.getTimeline({ limit: 10 })
  return res.data.feed.map((item) => ({
    handle: item.post.author.handle,
    text: String((item.post.record as { text?: string }).text ?? ''),
    reposted: item.reason?.$type === 'app.bsky.feed.defs#reasonRepost',
  }))
}

export async function signOut(did: string): Promise<void> {
  await (await getClient()).revoke(did)
}
