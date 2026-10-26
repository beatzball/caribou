import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import DOMPurify from 'dompurify'
import type { mastodon } from 'masto'
import { PURIFY_OPTS } from '@beatzball/caribou-mastodon-client/sanitize-opts'
import { formatRelativeTime } from '@beatzball/caribou-ui-headless'
import { effect } from '@preact/signals-core'
import {
  activeClient, activeUser, isOwnAccount, statusCache,
  toggleBookmark, toggleFavourite, toggleReblog,
} from '@beatzball/caribou-state'
import { ICONS } from './_icons.js'

export type StatusCardVariant = 'timeline' | 'focused' | 'ancestor' | 'descendant'

function absoluteLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// Permalink for the timestamp anchor.
//
// The id we encode is the home instance's local id for the status (i.e.
// `status.id` as masto.js returns it from the home timeline). The route
// resolver for `/@:handle/:statusId` queries the home instance — never
// the path host — because status ids are minted per-instance and the home
// instance is the only one guaranteed to recognize this id. The handle in
// the path is for display + share-context, not routing.
//
// This matches Elk's `/{home-instance}/@{user}@{host}/{home-id}` model;
// Caribou drops the leading `/{home-instance}/` segment because we tie
// the home instance to the `caribou.instance` cookie instead of the URL.
//
// Edge case: a status whose id contains characters that are unsafe in a
// URL path (some non-Mastodon ActivityPub bridges expose ids with `/`,
// `:`, etc.). Encode via `encodeURIComponent` so the URL stays
// well-formed; the route resolver decodes it back.
type Status = mastodon.v1.Status

// The fields the action bar shows. The card re-reads them from the status
// cache after mount, so an action taken anywhere shows here even when the
// parent's `.status` is a copy the cache does not own (the thread store).
interface ActionFields {
  favourited: boolean
  favouritesCount: number
  reblogged: boolean
  reblogsCount: number
  bookmarked: boolean
  repliesCount: number
}

function actionFields(s: Status): ActionFields {
  return {
    favourited: s.favourited === true,
    favouritesCount: s.favouritesCount ?? 0,
    reblogged: s.reblogged === true,
    reblogsCount: s.reblogsCount ?? 0,
    bookmarked: s.bookmarked === true,
    repliesCount: s.repliesCount ?? 0,
  }
}

function sameFields(a: ActionFields, b: ActionFields): boolean {
  return a.favourited === b.favourited && a.favouritesCount === b.favouritesCount
    && a.reblogged === b.reblogged && a.reblogsCount === b.reblogsCount
    && a.bookmarked === b.bookmarked && a.repliesCount === b.repliesCount
}

// The page sets the instance its data came from on the shell, and the card
// sits inside other elements' shadow roots, so walk up through each shadow
// host until a shell is found.
function findShell(from: Element): Element | null {
  let el: Element | null = from
  while (el) {
    const shell = el.closest('caribou-app-shell')
    if (shell) return shell
    const root = el.getRootNode()
    el = root instanceof ShadowRoot ? root.host : null
  }
  return null
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function statusPermalink(s: { id: string; account: { acct: string } }): string {
  return `/@${s.account.acct}/${encodeURIComponent(s.id)}`
}

@customElement('caribou-status-card')
export class CaribouStatusCard extends LitElement {
  static override styles = css`
    :host { display: block; }
    article { padding: var(--space-4); border-bottom: 1px solid var(--border); }
    .row { display: flex; gap: var(--space-3); }
    img { border-radius: var(--radius-md); flex-shrink: 0; }
    .body { min-width: 0; flex: 1; }
    header { display: flex; gap: var(--space-2); align-items: baseline; flex-wrap: wrap; }
    header strong { color: var(--fg-0); }
    .acct { color: var(--fg-muted); }
    .status-content { color: var(--fg-0); margin-top: var(--space-2); }
    .status-content,
    .status-content > p,
    .status-content a {
      overflow-wrap: anywhere;
      word-break: break-word;
      min-width: 0;
    }
    /* Mastodon emits author-typed "#AI#Tech" as <a>#AI</a><a>#Tech</a> with no
       whitespace between them. Push the second link a quarter em to its
       inline-start side; the gap sits outside the link's content area, so the
       underline ends cleanly with each link instead of bridging an injected
       space. */
    .status-content a + a {
      margin-inline-start: 0.25em;
    }
    /* Focused post emphasis: bigger body type only. The accent border was
       visually load-bearing in the wrong direction — readers mistook the
       blue 1px outline for an "older posts" affordance. Ancestor opacity
       and descendant indentation already differentiate the focused row. */
    article[data-variant="focused"] .status-content { font-size: 1.1rem; }
    article[data-variant="ancestor"] { opacity: 0.75; }
    article[data-variant="descendant"] { margin-inline-start: var(--space-4); }
    time { color: var(--fg-muted); font-size: 0.875rem; }
    .permalink {
      color: inherit; text-decoration: none;
    }
    .permalink:hover time { text-decoration: underline; }
    .actions {
      display: flex; gap: var(--space-4); margin-top: var(--space-3);
      margin-inline-start: calc(-1 * var(--space-2));
    }
    .actions button {
      display: inline-flex; align-items: center; gap: var(--space-1);
      min-width: 2.5rem; min-height: 2rem; padding: 0 var(--space-2);
      border: 0; border-radius: var(--radius-md); background: none;
      color: var(--fg-muted); font: inherit; font-size: 0.875rem; cursor: pointer;
    }
    .actions button:hover:not([aria-disabled="true"]) { color: var(--fg-0); background: var(--bg-1); }
    .actions button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .actions button[aria-disabled="true"] { cursor: default; opacity: 0.6; }
    .actions button[aria-pressed="true"] { color: var(--accent); }
    .actions button.boost[aria-pressed="true"] { color: var(--success); }
    .actions button[aria-pressed="true"] svg path { fill: currentColor; }
    .actions button.boost[aria-pressed="true"] svg path { fill: none; }
    .sr-only {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap;
    }
    .boost-attribution {
      display: flex; gap: var(--space-2); align-items: center;
      padding: 0 0 var(--space-2) var(--space-2);
      color: var(--fg-muted); font-size: 0.875rem;
    }
  `

  @property({ attribute: false }) status: mastodon.v1.Status | null = null
  @property({ reflect: true }) variant: StatusCardVariant = 'timeline'
  // The instance the status came from. Optional: without it the card reads
  // the instance off the enclosing `<caribou-app-shell>` after mount.
  @property() instance = ''

  // Both start false, so the server and the first client render show the
  // signed-out bar. `bindActions` sets them after mount.
  @state() private canAct = false
  @state() private ownPost = false
  @state() private liveFields: ActionFields | null = null

  private disposeActions: (() => void) | null = null
  private shellObserver: MutationObserver | null = null

  // The server prints an absolute timestamp so its HTML does not depend on
  // the clock. The first client render repeats it; after that the card
  // switches to the relative form.
  @state() private relativeTime = false

  // True when the shadow root came from the server (declarative shadow DOM)
  // and the first render hydrates it instead of creating it.
  private adoptedServerRender = false

  private retryUrl = ''
  private retries = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined

  protected override createRenderRoot() {
    this.adoptedServerRender = this.shadowRoot !== null
    return super.createRenderRoot()
  }

  protected override firstUpdated() {
    this.relativeTime = true
    this.bindActions()
  }

  override connectedCallback() {
    super.connectedCallback()
    // Re-attach after a move in the DOM; the first bind is in firstUpdated.
    if (this.hasUpdated && !this.disposeActions) this.bindActions()
  }

  override disconnectedCallback() {
    clearTimeout(this.retryTimer)
    this.unbindActions()
    super.disconnectedCallback()
  }

  private unbindActions() {
    this.disposeActions?.()
    this.disposeActions = null
    this.shellObserver?.disconnect()
    this.shellObserver = null
  }

  private bindActions() {
    // The shell's `instance` is an attribute, not a signal; watch it so a
    // change re-decides whether this card can act.
    if (!this.instance) {
      const shell = findShell(this)
      if (shell) {
        this.shellObserver = new MutationObserver(() => this.rebindActions())
        this.shellObserver.observe(shell, { attributes: true, attributeFilter: ['instance'] })
      }
    }
    this.disposeActions = effect(() => {
      const client = activeClient.value
      const user = activeUser.value
      const s = this.status
      const post = s?.reblog ?? s
      this.canAct = client !== null && this.sameInstance(user?.server)
      this.ownPost = this.canAct && post !== null && post !== undefined && user !== null && isOwnAccount(user, post.account)
      const cache = statusCache.value
      const cached = post ? cache.get(post.id) ?? (s?.reblog ? cache.get(s.id)?.reblog : undefined) : undefined
      const next = cached ? actionFields(cached) : null
      const prev = this.liveFields
      if (next === null ? prev !== null : prev === null || !sameFields(prev, next)) this.liveFields = next
    })
  }

  // Hosts are case-insensitive; `server` is a bare host, like `instance`.
  // No known instance means the page did not say, as in caribou-profile.
  private sameInstance(server: string | undefined): boolean {
    const instance = this.instance || (findShell(this)?.getAttribute('instance') ?? '')
    if (!instance) return true
    return server !== undefined && server.toLowerCase() === instance.toLowerCase()
  }

  private rebindActions() {
    this.unbindActions()
    this.bindActions()
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>) {
    // The effect only re-runs on a signal change. A new `.status` must not
    // show the old post's cached fields for a render, and a new `instance`
    // decides again whether the buttons act.
    if ((changed.has('status') || changed.has('instance')) && this.disposeActions) {
      this.rebindActions()
    }
  }

  private onReply = () => {
    if (!this.canAct || !this.status) return
    window.dispatchEvent(new CustomEvent('caribou:compose', {
      detail: { inReplyTo: this.status.reblog ?? this.status },
    }))
  }

  private onFavourite = () => {
    if (this.canAct && this.status) void toggleFavourite(this.status)
  }

  private onBoost = () => {
    if (this.canAct && this.status && this.canBoost(this.status.reblog ?? this.status)) {
      void toggleReblog(this.status)
    }
  }

  private onBookmark = () => {
    if (this.canAct && this.status) void toggleBookmark(this.status)
  }

  // Mastodon: nobody boosts a direct post, and only its author boosts a
  // followers-only one.
  private canBoost(post: Status): boolean {
    if (post.visibility === 'direct') return false
    if (post.visibility === 'private') return this.ownPost
    return true
  }

  private renderActions(post: Status) {
    const f = this.liveFields ?? actionFields(post)
    const off = !this.canAct
    const boostable = this.canBoost(post)
    const boostHint = !boostable
      ? 'This post cannot be boosted'
      : off ? 'Sign in to boost' : ''
    const count = (n: number) => n > 0 ? html`<span class="count">${n}</span>` : nothing
    const title = (hint: string) => hint || nothing
    // The label names the action; the description carries the count and
    // the hint a mouse user reads in the title. Ids are scoped to this
    // card's shadow root.
    const describe = (...parts: string[]) => parts.filter(Boolean).join('. ')
    const hint = (verb: string) => off ? `Sign in to ${verb}` : ''
    const d = {
      reply: describe(plural(f.repliesCount, 'reply', 'replies'), hint('reply')),
      boost: describe(plural(f.reblogsCount, 'boost', 'boosts'), boostHint),
      favourite: describe(plural(f.favouritesCount, 'favourite', 'favourites'), hint('favourite')),
      bookmark: hint('bookmark'),
    }
    return html`
      <div class="actions" role="group" aria-label="Post actions">
        <button type="button" class="reply" aria-label="Reply"
                aria-describedby="desc-reply"
                aria-disabled=${off ? 'true' : 'false'}
                title=${title(hint('reply'))}
                @click=${this.onReply}>${ICONS.messageCircle}${count(f.repliesCount)}</button>
        <button type="button" class="boost" aria-label=${f.reblogged ? 'Undo boost' : 'Boost'}
                aria-describedby="desc-boost"
                aria-pressed=${f.reblogged ? 'true' : 'false'}
                aria-disabled=${off || !boostable ? 'true' : 'false'}
                title=${title(boostHint)}
                @click=${this.onBoost}>${ICONS.repeat2}${count(f.reblogsCount)}</button>
        <button type="button" class="favourite" aria-label=${f.favourited ? 'Unfavourite' : 'Favourite'}
                aria-describedby="desc-favourite"
                aria-pressed=${f.favourited ? 'true' : 'false'}
                aria-disabled=${off ? 'true' : 'false'}
                title=${title(hint('favourite'))}
                @click=${this.onFavourite}>${ICONS.star}${count(f.favouritesCount)}</button>
        <button type="button" class="bookmark" aria-label=${f.bookmarked ? 'Remove bookmark' : 'Bookmark'}
                aria-describedby=${d.bookmark ? 'desc-bookmark' : nothing}
                aria-pressed=${f.bookmarked ? 'true' : 'false'}
                aria-disabled=${off ? 'true' : 'false'}
                title=${title(hint('bookmark'))}
                @click=${this.onBookmark}>${ICONS.bookmark}</button>
        <span class="sr-only" id="desc-reply">${d.reply}</span>
        <span class="sr-only" id="desc-boost">${d.boost}</span>
        <span class="sr-only" id="desc-favourite">${d.favourite}</span>
        <span class="sr-only" id="desc-bookmark">${d.bookmark}</span>
      </div>
    `
  }

  // Avatars sometimes truncate mid-response under CDN load
  // (`net::ERR_CONNECTION_CLOSED` arrives with a 200 status — the headers
  // landed but the bytes didn't). Bounded retry: clear `src`, restore it
  // after a short backoff, give up after two attempts and dim the broken
  // avatar so layout stays intact. The retry budget resets when `src`
  // changes (status update → new URL).
  private onAvatarError = (e: Event) => {
    const img = e.currentTarget as HTMLImageElement
    const currentSrc = img.src
    if (this.retryUrl !== currentSrc) {
      this.retryUrl = currentSrc
      this.retries = 0
    }
    if (this.retries >= 2) {
      img.style.opacity = '0.4'
      return
    }
    this.retries += 1
    img.removeAttribute('src')
    this.retryTimer = setTimeout(() => {
      // A render during the backoff may have written a newer URL; keep it.
      if (!img.hasAttribute('src')) img.setAttribute('src', currentSrc)
    }, 300 * this.retries)
  }

  // The page's `pageData` pre-sanitizes on the server with the jsdom-backed
  // sanitizer, and DOMPurify cannot run there (no window), so the server
  // trusts that string. The client re-sanitizes as defense-in-depth for
  // poll-fetched content.
  //
  // One exception: the render that hydrates a server-made shadow root.
  // `unsafeHTML` hydration compares a digest of the HTML string, so a
  // one-character difference between the two sanitizers' output would throw
  // and break the whole page. That string is already in the DOM, so trusting
  // it for this one render exposes nothing new; the next render re-sanitizes.
  //
  // The server test is `typeof window`, not Lit's `isServer`: the unit tests
  // load Lit's node build, where `isServer` is true even with a DOM present.
  private safeContent(content: string): string {
    if (typeof window === 'undefined') return content
    if (this.adoptedServerRender && !this.hasUpdated) return content
    return DOMPurify.sanitize(content, PURIFY_OPTS)
  }

  override render() {
    const s = this.status
    if (!s) return nothing
    // For reblogs the rendered post is the inner status — boosts ARE the
    // inner post in Mastodon's data model. The wrapper carries only the
    // booster's account + a createdAt for "when this was boosted to my
    // timeline". Render the inner content as the body, prepend a small
    // attribution row that names the booster.
    const display = s.reblog ?? s
    const dt = display.createdAt
    const timeLabel = this.relativeTime ? formatRelativeTime(dt) : absoluteLabel(dt)
    const boostName = s.reblog ? (s.account.displayName || s.account.username) : null
    // Permalink: anchor on the timestamp, not the whole article — wrapping the
    // <article> would put the post-content links (hashtags, mentions, external
    // urls) inside an <a>, and the HTML parser closes the outer anchor when
    // it sees the inner one. The timestamp anchor is the no-JS-safe primitive.
    // `<litro-link>` keeps that anchor (the server renders it) and turns a
    // plain click into a client-side navigation to the thread.
    return html`
      <article data-variant=${this.variant}>
        ${boostName
          ? html`<div class="boost-attribution">
                   <span class="boost-icon">${ICONS.repeat2}</span>
                   <span>${boostName} boosted</span>
                 </div>`
          : nothing}
        <div class="row">
          <img src=${display.account.avatarStatic || display.account.avatar}
               alt=""
               width="48" height="48"
               loading="lazy"
               decoding="async"
               @error=${this.onAvatarError} />
          <div class="body">
            <header>
              <strong>${display.account.displayName || display.account.username}</strong>
              <span class="acct">@${display.account.acct}</span>
              <litro-link class="permalink" href=${statusPermalink(display)}>
                <time datetime=${dt}>${timeLabel}</time>
              </litro-link>
            </header>
            <div class="status-content">${unsafeHTML(this.safeContent(display.content ?? ''))}</div>
            ${this.renderActions(display)}
          </div>
        </div>
      </article>
    `
  }
}
