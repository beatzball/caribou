import { Elena, html, unsafeHTML } from '@elenajs/core'
import DOMPurify from 'dompurify'
import type { mastodon } from 'masto'
import { PURIFY_OPTS } from '@beatzball/caribou-mastodon-client/sanitize-opts'
import { formatRelativeTime } from '@beatzball/caribou-ui-headless'
import { ICONS } from './_icons.js'

// Wrap rules for sanitized post HTML. They used to live in the global
// design-tokens stylesheet, but moving the card to shadow DOM walls the
// rendered tree off from light-DOM CSS — the global rules no longer
// reach inside. Adopting them via `static styles` puts them on the
// shadow root's `adoptedStyleSheets`, which the constructable-stylesheet
// platform path makes a one-time-per-class cost.
const STATUS_STYLES = `
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
  article[data-variant="focused"] {
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }
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

type Variant = 'timeline' | 'focused' | 'ancestor' | 'descendant'

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

export class CaribouStatusCard extends Elena(HTMLElement) {
  static override tagName = 'caribou-status-card'
  // Shadow DOM walls the rendered <article> off from the parent timeline's
  // morph engine. Without it, parent re-renders (e.g. on poll) recursed
  // into the card's light-DOM children and stripped the avatar + content,
  // causing visible flicker and avatar re-fetches. CSS custom properties
  // (`var(--bg-0)` etc.) inherit through shadow boundaries so the design
  // tokens still apply.
  static override shadow = 'open' as const
  static override styles = STATUS_STYLES
  // `status` is an object — mark reflect:false so assigning it triggers a
  // re-render but does NOT stringify the whole status to an attribute.
  static override props = [
    { name: 'status',  reflect: false },
    { name: 'variant', reflect: true  },
  ]

  status: mastodon.v1.Status | null = null
  variant: Variant = 'timeline'

  // Pre-hydration mode emits an absolute timestamp so the SSR'd HTML is
  // deterministic (no Date.now() drift between server and client). After
  // the first microtask we flip to the relative form.
  private _hydrated = false

  override connectedCallback() {
    super.connectedCallback?.()
    queueMicrotask(() => {
      this._hydrated = true
      this.requestUpdate?.()
    })
  }

  override updated() {
    // Avatars sometimes truncate mid-response under CDN load
    // (`net::ERR_CONNECTION_CLOSED` arrives with a 200 status — the headers
    // landed but the bytes didn't). Wire one error listener per <img> for a
    // bounded retry: clear `src`, restore it after a short backoff, give up
    // after two attempts and dim the broken avatar so layout stays intact.
    // Resets the retry budget when `src` changes (status update → new URL).
    const img = this.shadowRoot?.querySelector<HTMLImageElement>('img')
    if (!img || img.dataset.retryWired === '1') return
    img.dataset.retryWired = '1'
    img.addEventListener('error', () => {
      const currentSrc = img.src
      if (img.dataset.retryUrl !== currentSrc) {
        img.dataset.retryUrl = currentSrc
        img.dataset.retries = '0'
      }
      const tries = Number(img.dataset.retries ?? '0')
      if (tries >= 2) {
        img.style.opacity = '0.4'
        return
      }
      img.dataset.retries = String(tries + 1)
      img.removeAttribute('src')
      setTimeout(() => { img.setAttribute('src', currentSrc) }, 300 * (tries + 1))
    })
  }

  override render() {
    // Render the sanitized status HTML inline via `unsafeHTML` instead of
    // imperatively writing `.innerHTML` in `updated()`. Mutating innerHTML
    // on every render creates a parse-and-replace window that Playwright's
    // text locators can transiently observe as "more than one match" under
    // strict mode, even though the final DOM contains exactly one paragraph.
    // `unsafeHTML` interpolates the trusted (DOMPurify-sanitized) string
    // directly into the template, so the content moves atomically with the
    // rest of the render.
    const s = this.status
    if (!s) return html``
    // For reblogs the rendered post is the inner status — boosts ARE the
    // inner post in Mastodon's data model. The wrapper carries only the
    // booster's account + a createdAt for "when this was boosted to my
    // timeline". Render the inner content as the body, prepend a small
    // attribution row that names the booster.
    const display = s.reblog ?? s
    const safe = DOMPurify.sanitize(display.content ?? '', PURIFY_OPTS)
    const dt = display.createdAt
    const relLabel = this._hydrated ? formatRelativeTime(dt) : absoluteLabel(dt)
    const boostName = s.reblog ? (s.account.displayName || s.account.username) : null
    // Permalink: anchor on the timestamp, not the whole article — wrapping the
    // <article> would put the post-content links (hashtags, mentions, external
    // urls) inside an <a>, and the HTML parser closes the outer anchor when
    // it sees the inner one. Elk-style "click anywhere on the card" delegation
    // (target-walking + selection check) is a JS-only enhancement deferred to
    // Plan 4 (interactions); the timestamp anchor is the no-JS-safe primitive.
    const permalink = statusPermalink(display)
    return html`
      <article data-variant=${this.variant}
               style="padding:var(--space-4);border-bottom:1px solid var(--border);">
        ${boostName
          ? html`<div class="boost-attribution">
                   <span class="boost-icon">${ICONS.repeat2}</span>
                   <span>${boostName} boosted</span>
                 </div>`
          : html``}
        <div style="display:flex;gap:var(--space-3);">
          <img src=${display.account.avatarStatic || display.account.avatar}
               alt=""
               width="48" height="48"
               loading="lazy"
               decoding="async"
               style="border-radius:var(--radius-md);flex-shrink:0;" />
          <div style="min-width:0;flex:1;">
            <header style="display:flex;gap:var(--space-2);align-items:baseline;flex-wrap:wrap;">
              <strong style="color:var(--fg-0);">${display.account.displayName || display.account.username}</strong>
              <span style="color:var(--fg-muted);">@${display.account.acct}</span>
              <a class="permalink" href="${permalink}">
                <time datetime=${dt}>${relLabel}</time>
              </a>
            </header>
            <div class="status-content" style="color:var(--fg-0);margin-top:var(--space-2);">${unsafeHTML(safe)}</div>
          </div>
        </div>
      </article>
    `
  }
}
CaribouStatusCard.define()
