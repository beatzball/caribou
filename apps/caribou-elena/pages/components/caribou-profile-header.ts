import { Elena, html, unsafeHTML } from '@elenajs/core'
import DOMPurify from 'dompurify'
import { PURIFY_OPTS } from '@beatzball/caribou-mastodon-client/sanitize-opts'
import type { Account } from '@beatzball/caribou-mastodon-client'

const HEADER_CSS = `
  :host { display: block; border-bottom: 1px solid var(--border); }
  .banner { aspect-ratio: 3/1; background: var(--bg-2); }
  .row    { display: flex; gap: var(--space-3); padding: var(--space-3); }
  img.avatar { width: 80px; height: 80px; border-radius: var(--radius-md); flex-shrink: 0; }
  .name   { color: var(--fg-0); font-weight: 600; font-size: 1.25rem; }
  .handle { color: var(--fg-muted); }
  .bio    { color: var(--fg-1); padding: 0 var(--space-3) var(--space-3); }
  .counts { display: flex; gap: var(--space-4); padding: 0 var(--space-3) var(--space-3); color: var(--fg-1); }
`

export class CaribouProfileHeader extends Elena(HTMLElement) {
  static override tagName = 'caribou-profile-header'
  static override shadow = 'open' as const
  static override styles = HEADER_CSS
  static override props = [{ name: 'account', reflect: false }]
  account: Account | null = null

  override render() {
    const a = this.account
    if (!a) return html``
    const safe = DOMPurify.sanitize(a.note ?? '', PURIFY_OPTS) as unknown as string
    const headerImg = a.headerStatic || a.header
    return html`
      <div class="banner" style=${headerImg ? `background-image:url(${headerImg});background-size:cover;` : ''}></div>
      <div class="row">
        <img class="avatar" src=${a.avatarStatic || a.avatar} alt="" loading="lazy" decoding="async"/>
        <div>
          <div class="name">${a.displayName || a.username}</div>
          <div class="handle">@${a.acct}</div>
        </div>
      </div>
      <div class="bio">${unsafeHTML(safe)}</div>
      <div class="counts">
        <span><strong>${String(a.statusesCount)}</strong> Posts</span>
        <span><strong>${String(a.followingCount)}</strong> Following</span>
        <span><strong>${String(a.followersCount)}</strong> Followers</span>
      </div>
    `
  }
}
CaribouProfileHeader.define()
