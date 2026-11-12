import { html, css, type PropertyValues } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import { activeClient, activeUserKey } from '@beatzball/caribou-state'
import { LitroPage, pageReset, type LitroLocation } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { getQuery, getRouterParams } from 'h3'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'
import { shellInfo } from '../../server/lib/shell-info.js'
import { fetchTagTimeline } from '../../server/lib/mastodon-public.js'
import { getStorage } from '../../server/lib/storage.js'
import { PAGE_TITLE } from '../../server/lib/brand-head.js'
import type { TimelinePageData, ShellInfo } from '../../server/lib/page-data-types.js'
import '../../components/caribou-app-shell.js'
import '../../components/caribou-timeline.js'
import type { TimelineInitial } from '../../components/caribou-timeline.js'
import '../../components/caribou-tag-header.js'
import '../../components/caribou-auth-required.js'
import '../../components/caribou-bluesky-tag.js'
import { enterWithCache } from '../../components/_page-cache.js'
import { blueskyTagRedirect, parseTagParam, tagPath } from '../../components/_tag-path.js'

// `tag` is the name as the path gave it, decoded; case is kept for the
// heading, and the server ignores it. `not-found` is a name no hashtag can
// have, so no request goes out for it. `bluesky` is `?net=bsky`: post
// search needs a token, so the server fetches nothing and the client
// decides (`<caribou-bluesky-tag>`; README, "Bluesky search and hashtag page").
export type TagPageData = (TimelinePageData | { kind: 'not-found' } | { kind: 'bluesky' }) & {
  shell: ShellInfo
  tag: string
  /** The document title; Litro moves it into `<title>` and out of the data. */
  seoTitle?: string
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const titleFor = (tag: string) => `#${tag} · ${PAGE_TITLE}`

// Whether the address bar shows the page for `tag`: the path segment names
// it, as the page data read it (decoded for a name that is not a hashtag,
// parsed for one that is).
function atTagPath(tag: string): boolean {
  const m = /^\/tags\/([^/]+)$/.exec(location.pathname)
  if (!m) return false
  let decoded: string | null = null
  try { decoded = decodeURIComponent(m[1]!) } catch { /* keep it null */ }
  return decoded === tag || parseTagParam(m[1]!) === tag
}

export const pageData = definePageData<TagPageData>(async (event) => {
  const raw = String((getRouterParams(event) as { tag?: string }).tag ?? '')
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage() })
  const shell: ShellInfo = shellInfo(resolution)
  const tag = parseTagParam(raw)
  if (tag === null) {
    let shown = raw
    try { shown = decodeURIComponent(raw) } catch { /* keep it encoded */ }
    return { kind: 'not-found', shell, tag: shown, seoTitle: escapeHtml(titleFor(shown)) }
  }
  // Litro writes `seoTitle` into the page as it is, so it is escaped here.
  const seoTitle = escapeHtml(titleFor(tag))
  const query = getQuery(event)
  if (query.net === 'bsky') return { kind: 'bluesky', shell, tag, seoTitle }
  if (!resolution.instance) return { kind: 'auth-required', shell, tag, seoTitle }
  const maxId = typeof query.max_id === 'string' ? query.max_id : undefined
  try {
    const fetched = await fetchTagTimeline({ instance: resolution.instance, tag, maxId })
    // Dynamic import keeps jsdom out of the client bundle (see local.ts).
    const { sanitizeStatus } = await import('../../server/lib/sanitize.js')
    const statuses = fetched.map((s) => sanitizeStatus(s))
    // The next page starts below the last post (see local.ts).
    const nextCursor = statuses.length > 0 ? statuses[statuses.length - 1]!.id : null
    return { kind: 'ok', statuses, nextCursor, shell, tag, seoTitle }
  } catch (err) {
    return { kind: 'error', message: String(err), shell, tag, seoTitle }
  }
})

@customElement('page-tags-tag')
export class TagPage extends LitroPage {
  static override styles = [pageReset, css`
    article { padding: var(--space-4); color: var(--fg-muted); }
    litro-link { color: var(--accent); text-decoration-line: underline; }
  `]

  // True after mount while an account is active. The server knew no
  // instance (no cookie), so it sent the sign-in placeholder; a signed-in
  // reader then gets the timeline from their own server instead. Read after
  // the first update, so the first client render equals the server's.
  @state() private signedIn = false
  private disposeSession: (() => void) | null = null

  // True after mount while a Bluesky account is active: the page then shows
  // the Bluesky tag page in place of the Mastodon one.
  @state() private bluesky = false
  // True once the address of this page's data is `?net=bsky`: this page
  // rewrote it, or an earlier copy did (on a full load the router swaps in a
  // second copy with the same data after the first one rewrote it, #254).
  // From then on it is the Bluesky page, whatever account is active, so the
  // address and the body agree (#251). New page data starts over.
  @state() private routed = false
  private network: string | null = null

  // A Bluesky reader on the Mastodon tag page gets the Bluesky one (README,
  // "Bluesky search and hashtag page"). The Mastodon timeline is shown only
  // with a Mastodon account active. The page renders the Bluesky body
  // itself and only rewrites the address (`blueskyTagRedirect`): a route
  // change during a full load's mount swap would be missed by the router.
  protected override firstUpdated() {
    this.disposeSession = effect(() => {
      const network = activeClient.value?.capabilities.network ?? null
      this.network = network
      this.signedIn = activeUserKey.value !== null && network !== 'bluesky'
      this.bluesky = network === 'bluesky'
      this.routeToBluesky()
    })
  }

  protected override willUpdate(changed: PropertyValues<this>) {
    // New page data (the router can reuse this element): decide again.
    if (this.hasUpdated && changed.has('serverData' as keyof TagPage)) this.routed = false
  }

  // Rewrites `/tags/<tag>` to `/tags/<tag>?net=bsky` for a Bluesky reader.
  // An address that already has `net=bsky` counts as rewritten.
  private routeToBluesky() {
    const data = this.serverData as TagPageData | null
    if (!this.isConnected || !data || data.kind === 'not-found' || data.kind === 'bluesky' || !atTagPath(data.tag)) return
    if (new URLSearchParams(location.search).get('net') === 'bsky') {
      this.routed = true
      return
    }
    const to = blueskyTagRedirect(location.pathname, location.search, this.network)
    if (!to) return
    history.replaceState(history.state, '', to)
    this.routed = true
  }

  // A revisit paints from the last copy at once, and the fresh page data
  // that follows only fills the new-posts banner (`enterWithCache`).
  override onBeforeEnter(location: LitroLocation) {
    return enterWithCache(this, location, () => super.onBeforeEnter(location), {
      onFresh: (fresh) => { this.serverData = fresh },
    })
  }

  protected override updated(changed: PropertyValues<this>) {
    if (changed.has('serverData' as keyof TagPage) && this.disposeSession) this.routeToBluesky()
  }

  override disconnectedCallback() {
    this.disposeSession?.()
    this.disposeSession = null
    super.disconnectedCallback()
  }

  override render() {
    const data = (this.serverData ?? { kind: 'auth-required', shell: { instance: null }, tag: '' }) as TagPageData
    const inst = data.shell.instance ?? ''
    if (data.kind === 'not-found') {
      return html`
        <caribou-app-shell instance=${inst}>
          <article>#${data.tag} is not a hashtag.</article>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'bluesky' || this.routed || (this.bluesky && data.tag)) {
      return html`
        <caribou-app-shell instance=${inst}>
          <caribou-bluesky-tag tag=${data.tag}></caribou-bluesky-tag>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'auth-required' && this.signedIn && data.tag) {
      return this.renderTimeline(inst, data.tag, null)
    }
    if (data.kind === 'auth-required') {
      return html`
        <caribou-app-shell instance=${inst}>
          <caribou-auth-required
            label=${`#${data.tag} needs to know which instance to query. Sign in once and Caribou will remember.`}
          ></caribou-auth-required>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'error') {
      return html`
        <caribou-app-shell instance=${inst}>
          <article role="alert">
            Couldn't load #${data.tag}. <litro-link href=${tagPath(data.tag)}>Retry</litro-link>
          </article>
        </caribou-app-shell>
      `
    }
    return this.renderTimeline(inst, data.tag, data)
  }

  // `initial` is the server's first page; without it the timeline fetches
  // that page itself.
  private renderTimeline(inst: string, tag: string, initial: TimelineInitial | null) {
    return html`
      <caribou-app-shell instance=${inst}>
        <div>
          <caribou-tag-header name=${tag}></caribou-tag-header>
          <caribou-timeline kind="hashtag" tag=${tag} .initial=${initial}></caribou-timeline>
        </div>
      </caribou-app-shell>
    `
  }
}

export default TagPage
