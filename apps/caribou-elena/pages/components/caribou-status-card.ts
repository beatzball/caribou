import { Elena, html, unsafeHTML } from '@elenajs/core'
import DOMPurify from 'dompurify'
import type { mastodon } from 'masto'

const PURIFY_OPTS = {
  ALLOWED_TAGS: ['p', 'br', 'a', 'span', 'em', 'strong', 'ul', 'ol', 'li', 'code', 'pre'],
  ALLOWED_ATTR: ['href', 'rel', 'target', 'class', 'lang'],
  ALLOW_DATA_ATTR: false,
}

export class CaribouStatusCard extends Elena(HTMLElement) {
  static override tagName = 'caribou-status-card'
  // `status` is an object — mark reflect:false so assigning it triggers a
  // re-render but does NOT stringify the whole status to an attribute.
  static override props = [{ name: 'status', reflect: false }]

  status: mastodon.v1.Status | null = null

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
