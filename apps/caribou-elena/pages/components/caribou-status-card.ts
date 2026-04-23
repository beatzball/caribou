import { Elena, html } from '@elenajs/core'
import DOMPurify from 'dompurify'
import type { mastodon } from 'masto'

const PURIFY_OPTS = {
  ALLOWED_TAGS: ['p', 'br', 'a', 'span', 'em', 'strong', 'ul', 'ol', 'li', 'code', 'pre'],
  ALLOWED_ATTR: ['href', 'rel', 'target', 'class', 'lang'],
  ALLOW_DATA_ATTR: false,
}

export class CaribouStatusCard extends Elena(HTMLElement) {
  static override tagName = 'caribou-status-card'
  static override props = ['status']

  status: mastodon.v1.Status | null = null

  override render() {
    const s = this.status
    if (!s) return html``
    const safeHtml = DOMPurify.sanitize(s.content ?? '', PURIFY_OPTS)
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
          <div class="status-content" style="color:var(--fg-0);margin-top:var(--space-2);"
               .innerHTML=${safeHtml}></div>
        </div>
      </article>
    `
  }
}
CaribouStatusCard.define()
