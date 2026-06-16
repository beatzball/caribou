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
  // String default makes Elena treat `account` as a string-typed attribute,
  // so it does NOT auto-JSON.parse the slot. That matters because the parent
  // (<caribou-profile>) renders this element through its own Elena template:
  // an object-typed prop would have Elena parse the attribute, and during a
  // template instantiation the slot momentarily holds Elena's placeholder
  // marker — parsing it throws a console warning. We accept the SSR seed as a
  // JSON string and parse it ourselves (resolveAccount), tolerating the
  // transient marker. Tests still set `.account` to an Account object directly;
  // resolveAccount handles both shapes. Mirrors <caribou-list-mount>'s string
  // `items` prop.
  static override props = [{ name: 'account', reflect: false }]
  account: Account | string = ''

  private resolveAccount(): Account | null {
    const a = this.account
    if (!a) return null
    if (typeof a === 'string') {
      try { return JSON.parse(a) as Account } catch { return null }
    }
    return a
  }

  override render() {
    const a = this.resolveAccount()
    if (!a) return html``
    // SSR pre-sanitizes account.note at the data boundary (see @[handle].ts),
    // and DOMPurify isn't initialized in the SSR shim (no window). Trust the
    // pre-sanitized note server-side; re-sanitize client-side as defense in
    // depth. Mirrors caribou-status-card.
    const safe = typeof window !== 'undefined'
      ? (DOMPurify.sanitize(a.note ?? '', PURIFY_OPTS) as unknown as string)
      : (a.note ?? '')
    const headerImg = a.headerStatic || a.header
    return html`
      <div class="banner" style="${headerImg ? `background-image:url(${headerImg});background-size:cover;` : ''}"></div>
      <div class="row">
        <img class="avatar" src="${a.avatarStatic || a.avatar}" alt="" loading="lazy" decoding="async"/>
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
