import { Elena, html, unsafeHTML } from '@elenajs/core'
import DOMPurify from 'dompurify'
import type { mastodon } from 'masto'

const PURIFY_OPTS = {
  ALLOWED_TAGS: ['p', 'br', 'a', 'span', 'em', 'strong', 'ul', 'ol', 'li', 'code', 'pre'],
  ALLOWED_ATTR: ['href', 'rel', 'target', 'class', 'lang'],
  ALLOW_DATA_ATTR: false,
}

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
`

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
  static override props = [{ name: 'status', reflect: false }]

  status: mastodon.v1.Status | null = null

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
    const safe = DOMPurify.sanitize(s.content ?? '', PURIFY_OPTS)
    return html`
      <article style="padding:var(--space-4);border-bottom:1px solid var(--border);display:flex;gap:var(--space-3);">
        <img src=${s.account.avatarStatic || s.account.avatar}
             alt=""
             width="48" height="48"
             loading="lazy"
             decoding="async"
             style="border-radius:var(--radius-md);flex-shrink:0;" />
        <div style="min-width:0;flex:1;">
          <header style="display:flex;gap:var(--space-2);align-items:baseline;">
            <strong style="color:var(--fg-0);">${s.account.displayName || s.account.username}</strong>
            <span style="color:var(--fg-muted);">@${s.account.acct}</span>
          </header>
          <div class="status-content" style="color:var(--fg-0);margin-top:var(--space-2);">${unsafeHTML(safe)}</div>
        </div>
      </article>
    `
  }
}
CaribouStatusCard.define()
