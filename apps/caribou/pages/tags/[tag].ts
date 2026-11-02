import { html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import { activeUserKey } from '@beatzball/caribou-state'
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
import { enterWithCache } from '../../components/_page-cache.js'
import { parseTagParam, tagPath } from '../../components/_tag-path.js'

// `tag` is the name as the path gave it, decoded; case is kept for the
// heading, and the server ignores it. `not-found` is a name no hashtag can
// have, so no request goes out for it.
export type TagPageData = (TimelinePageData | { kind: 'not-found' }) & {
  shell: ShellInfo
  tag: string
  /** The document title; Litro moves it into `<title>` and out of the data. */
  seoTitle?: string
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const titleFor = (tag: string) => `#${tag} · ${PAGE_TITLE}`

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
  if (!resolution.instance) return { kind: 'auth-required', shell, tag, seoTitle }
  const query = getQuery(event)
  const maxId = typeof query.max_id === 'string' ? query.max_id : undefined
  try {
    const raw = await fetchTagTimeline({ instance: resolution.instance, tag, maxId })
    // Dynamic import keeps jsdom out of the client bundle (see local.ts).
    const { sanitizeStatus } = await import('../../server/lib/sanitize.js')
    const statuses = raw.map((s) => sanitizeStatus(s))
    const nextMaxId = statuses.length > 0 ? statuses[statuses.length - 1]!.id : null
    return { kind: 'ok', statuses, nextMaxId, shell, tag, seoTitle }
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

  protected override firstUpdated() {
    this.disposeSession = effect(() => { this.signedIn = activeUserKey.value !== null })
  }

  // A revisit paints from the last copy at once, and the fresh page data
  // that follows only fills the new-posts banner (`enterWithCache`).
  override onBeforeEnter(location: LitroLocation) {
    return enterWithCache(this, location, () => super.onBeforeEnter(location), {
      onFresh: (fresh) => { this.serverData = fresh },
    })
  }

  // The server writes the title into the page. The router does not change
  // it on a client-side move (brand-head.ts), so the page sets it, and puts
  // the app's title back when it leaves. On a full load the router swaps in
  // a second copy of the page before the first one leaves; that copy keeps
  // the title.
  protected override updated() {
    const data = this.serverData as TagPageData | null
    if (data?.tag) document.title = titleFor(data.tag)
  }

  override disconnectedCallback() {
    this.disposeSession?.()
    this.disposeSession = null
    super.disconnectedCallback()
    // No head: the whole document is going away.
    if (!document.head || document.querySelector('page-tags-tag')) return
    document.title = PAGE_TITLE
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
