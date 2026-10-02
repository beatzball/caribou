import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import DOMPurify from 'dompurify'
import type { mastodon } from 'masto'
import { PURIFY_OPTS } from '@beatzball/caribou-mastodon-client/sanitize-opts'
import { formatRelativeTime } from '@beatzball/caribou-ui-headless'
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
    .boost-attribution {
      display: flex; gap: var(--space-2); align-items: center;
      padding: 0 0 var(--space-2) var(--space-2);
      color: var(--fg-muted); font-size: 0.875rem;
    }
  `

  @property({ attribute: false }) status: mastodon.v1.Status | null = null
  @property({ reflect: true }) variant: StatusCardVariant = 'timeline'

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
  }

  override disconnectedCallback() {
    clearTimeout(this.retryTimer)
    super.disconnectedCallback()
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
              <a class="permalink" href=${statusPermalink(display)}>
                <time datetime=${dt}>${timeLabel}</time>
              </a>
            </header>
            <div class="status-content">${unsafeHTML(this.safeContent(display.content ?? ''))}</div>
          </div>
        </div>
      </article>
    `
  }
}
