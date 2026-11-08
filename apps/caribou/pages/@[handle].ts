import { html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { LitroPage, pageReset, type LitroLocation } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { getQuery, getRouterParams, setResponseStatus } from 'h3'
import { activeClient, activeUserKey } from '@beatzball/caribou-state'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { shellInfo } from '../server/lib/shell-info.js'
import {
  fetchAccountByHandle, fetchAccountStatuses,
} from '../server/lib/mastodon-public.js'
import { getStorage } from '../server/lib/storage.js'
import { blueskySsrEnabled } from '../server/lib/bluesky-flag.js'
import type { ProfilePageData, ShellInfo } from '../server/lib/page-data-types.js'
import '../components/caribou-app-shell.js'
import '../components/caribou-auth-required.js'
import '../components/caribou-profile.js'
import { enterWithCache } from '../components/_page-cache.js'
import {
  blueskyActor, didOfUserKey, decodeSegment, rendersBluesky, replaceDidRoute, routeOf, routeSegment,
} from '../components/_bluesky-route.js'
import { NO_UNAUTHENTICATED_NOTE } from '../components/_bluesky-moderation.js'

type Tab = 'posts' | 'replies' | 'media'

function parseTab(raw: unknown): Tab {
  return raw === 'replies' || raw === 'media' ? raw : 'posts'
}

// `hidden`: a Bluesky account that asked not to be seen signed out (spec
// 8.3); the data has no handle. `not-found`: a Bluesky route whose DID or
// handle is not well formed; nothing was fetched. `deferred`: the public
// AppView rate limited the server (#187); the page is the loading shell and
// the browser reads `appview` itself after hydration. No handle either: the
// server did not learn whether the account is hidden.
export type HandlePageData = (
  | ProfilePageData | { kind: 'hidden' } | { kind: 'not-found' } | { kind: 'deferred'; appview: string }
) & { shell: ShellInfo; handle: string }

export const pageData = definePageData<HandlePageData>(async (event) => {
  const params = getRouterParams(event) as { handle?: string }
  // Decoded as the client decodes it (`routeSegment`), so both sides read one route.
  const handle = decodeSegment(String(params.handle ?? ''))
  const resolution = await resolveInstanceForRoute(event, { handle }, { storage: getStorage() })
  const shell: ShellInfo = shellInfo(resolution)
  // /@me is auth-required (Plan 3 design §8.8): the user's own profile is
  // gated by the access token that lives only in localStorage, so the server
  // never performs a public lookup for `me`. It renders a placeholder; the
  // page swaps in the real profile on the client, the way /home does.
  if (handle === 'me') return { kind: 'auth-required', shell, handle } as HandlePageData
  const query = getQuery(event)
  const tab = parseTab(query.tab)
  const maxId = typeof query.max_id === 'string' ? query.max_id : undefined
  // A Bluesky route (spec 8.4; README, "Bluesky SSR"), behind the server flag.
  const route = routeOf(handle)
  // The flag is read before the import: with it off, no SDK load.
  if (route.network === 'bluesky' && blueskySsrEnabled()) {
    const bsky = await import('../server/lib/bluesky-public.js')
    if (!bsky.validActor(route.actor)) {
      setResponseStatus(event, 404)
      return { kind: 'not-found', shell, handle: '' }
    }
    try {
      const page = await bsky.fetchBlueskyProfilePage(route.actor, { tab, cursor: maxId })
      if (page.kind === 'hidden') return { kind: 'hidden', shell, handle: '' }
      return { ...page, tab, shell, handle } as HandlePageData
    } catch (err) {
      if (bsky.isRateLimited(err)) return { kind: 'deferred', appview: bsky.publicAppView(), shell, handle: '' }
      return { kind: 'error', message: String(err), shell, handle } as HandlePageData
    }
  }
  if (!resolution.instance) return { kind: 'auth-required', shell, handle } as HandlePageData
  try {
    const account = await fetchAccountByHandle(handle, { instance: resolution.instance })
    const rawStatuses = await fetchAccountStatuses(account.id, {
      instance: resolution.instance,
      tab,
      maxId,
    })
    // The fetcher never runs on the client; the dynamic import keeps the
    // jsdom-backed sanitizer out of the client bundle.
    const { sanitizeAccount, sanitizeStatus } = await import('../server/lib/sanitize.js')
    const statuses = rawStatuses.map(sanitizeStatus)
    // The first cursor goes to the client with the page: the profile store
    // asks for the next page by it. Mastodon pages a profile by status id.
    const nextCursor = statuses.length > 0 ? statuses[statuses.length - 1]!.id : null
    return {
      kind: 'ok', account: sanitizeAccount(account), statuses, nextCursor, tab, shell, handle,
    } as HandlePageData
  } catch (err) {
    return { kind: 'error', message: String(err), shell, handle } as HandlePageData
  }
})

@customElement('page-handle')
export class HandlePage extends LitroPage {
  static override styles = [pageReset, css`
    article { padding: 1rem; color: var(--fg-muted); }
  `]

  // On /@me: the signed-in user and the tab from the address bar. The server
  // knows neither, so both are read after the first update; the first render
  // is the placeholder the server sent.
  @state() private me: { userKey: string; tab: Tab } | null = null
  // A Bluesky profile, rendered on the client (phase 2b; README, "Bluesky
  // views"): the actor to look up and the segment the links keep. Set
  // after the first render, which matches the server's.
  @state() private bluesky: { actor: string; link: string; tab: Tab } | null = null
  // A deferred page's data, read by the browser (#187). Set after the
  // first render, which is the loading shell the server sent.
  @state() private fallback: HandlePageData | null = null

  protected override firstUpdated() {
    const data = this.serverData as HandlePageData | null
    // Opened by DID: show the handle form in the address bar (spec 8.4).
    if (data?.kind === 'ok' && data.account.bluesky) replaceDidRoute(window, data.handle, data.account)
    if (rendersBluesky(window, activeClient.value)) {
      const tab = parseTab(new URLSearchParams(window.location.search).get('tab'))
      const key = activeUserKey.value
      if (data?.handle === 'me' && key) {
        this.bluesky = { actor: didOfUserKey(key), link: 'me', tab }
        return
      }
      // A hidden profile's data has no handle: read the address.
      const actor = blueskyActor(data?.handle || routeSegment(window.location.pathname))
      if (actor) {
        this.bluesky = { actor, link: '', tab }
        return
      }
    }
    if (data?.kind === 'deferred') {
      void this.loadFallback(data)
      return
    }
    if (data?.handle !== 'me') return
    const userKey = activeUserKey.value
    if (!userKey) return
    this.me = { userKey, tab: parseTab(new URLSearchParams(window.location.search).get('tab')) }
  }

  // Signed out, or a Mastodon account: read the page from the public
  // AppView, through the same guard as the server (README, "Bluesky SSR:
  // rate limits").
  private async loadFallback(data: Extract<HandlePageData, { kind: 'deferred' }>) {
    const handle = routeSegment(window.location.pathname)
    const actor = blueskyActor(handle)
    if (!actor) return
    const query = new URLSearchParams(window.location.search)
    const tab = parseTab(query.get('tab'))
    const { publicProfilePage } = await import('../components/_bluesky-public.js')
    try {
      const page = await publicProfilePage(data.appview, actor, { tab, cursor: query.get('max_id') ?? undefined })
      if (page.kind === 'hidden') {
        this.fallback = { kind: 'hidden', shell: data.shell, handle: '' }
        return
      }
      this.fallback = { ...page, tab, shell: data.shell, handle }
      replaceDidRoute(window, handle, page.account)
    } catch (err) {
      this.fallback = { kind: 'error', message: String(err), shell: data.shell, handle: '' }
    }
  }

  // A revisit paints from the last copy at once. The fresh page data that
  // follows updates the posts' counts and edits through the status cache;
  // the list itself stays as it is until the next visit (`enterWithCache`).
  override onBeforeEnter(location: LitroLocation) {
    return enterWithCache(this, location, () => super.onBeforeEnter(location))
  }

  override render() {
    const data = (this.fallback ?? this.serverData ?? { kind: 'auth-required', shell: { instance: null }, handle: '' }) as HandlePageData
    const inst = data.shell.instance ?? ''
    if (this.bluesky) {
      const { actor, link, tab } = this.bluesky
      return html`
        <caribou-app-shell instance=${inst}>
          <caribou-profile handle=${actor} link-handle=${link} tab=${tab}></caribou-profile>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'auth-required' && this.me) {
      // No `initial`: the profile looks the account up through the signed-in
      // client, which holds the token the server never sees.
      return html`
        <caribou-app-shell instance=${inst}>
          <caribou-profile handle=${this.me.userKey} link-handle="me" tab=${this.me.tab}></caribou-profile>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'auth-required') {
      const label = data.handle === 'me'
        ? 'Your profile shows posts from your signed-in account. It requires a Mastodon access token, which Caribou keeps on your device.'
        : 'Profiles by bare handle (@user without @host) need to know which instance to query.'
      return html`
        <caribou-app-shell instance=${inst}>
          <caribou-auth-required label=${label}></caribou-auth-required>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'error') {
      return html`
        <caribou-app-shell instance=${inst}>
          <article role="alert">
            Couldn't load profile @${data.handle}.
          </article>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'hidden') {
      return html`
        <caribou-app-shell instance=${inst}>
          <article role="status">${NO_UNAUTHENTICATED_NOTE}</article>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'deferred') {
      return html`
        <caribou-app-shell instance=${inst}>
          <article role="status" aria-busy="true">Loading…</article>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'not-found') {
      return html`
        <caribou-app-shell instance=${inst}>
          <article role="alert">There is no Bluesky account by that name.</article>
        </caribou-app-shell>
      `
    }
    // A Bluesky profile has no instance: its ids are the same everywhere.
    return html`
      <caribou-app-shell instance=${inst}>
        <caribou-profile handle=${data.handle} tab=${data.tab} instance=${data.account.bluesky ? '' : inst} .initial=${data}></caribou-profile>
      </caribou-app-shell>
    `
  }
}

export default HandlePage
