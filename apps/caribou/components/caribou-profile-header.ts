import { LitElement, html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import DOMPurify from 'dompurify'
import { PURIFY_OPTS } from '@beatzball/caribou-mastodon-client/sanitize-opts'
import type { Account } from '@beatzball/caribou-mastodon-client'

@customElement('caribou-profile-header')
export class CaribouProfileHeader extends LitElement {
  static override styles = css`
    :host { display: block; border-bottom: 1px solid var(--border); }
    .banner { aspect-ratio: 3/1; background: var(--bg-2); }
    .row    { display: flex; gap: var(--space-3); padding: var(--space-3); }
    img.avatar { width: 80px; height: 80px; border-radius: var(--radius-md); flex-shrink: 0; }
    .name   { color: var(--fg-0); font-weight: 600; font-size: 1.25rem; }
    .handle { color: var(--fg-muted); }
    .bio    { color: var(--fg-1); padding: 0 var(--space-3) var(--space-3); }
    .counts { display: flex; gap: var(--space-4); padding: 0 var(--space-3) var(--space-3); color: var(--fg-1); }
  `

  @property({ attribute: false }) account: Account | null = null

  // True when the shadow root came from the server (declarative shadow DOM)
  // and the first render hydrates it instead of creating it.
  private adoptedServerRender = false

  protected override createRenderRoot() {
    this.adoptedServerRender = this.shadowRoot !== null
    return super.createRenderRoot()
  }

  // The server has no DOM for DOMPurify to work on, so the page's `pageData`
  // fetcher sanitizes `note` with the jsdom-backed sanitizer and the server
  // render trusts it. The client sanitizes again: an account that arrives
  // from a client-side fetch never passed through the server.
  //
  // One exception, the same one the status card makes: the render that
  // hydrates a server-made shadow root. `unsafeHTML` hydration compares a
  // digest of the HTML string, so a one-character difference between the two
  // sanitizers' output would throw and break the whole page. That string is
  // already in the DOM, so trusting it for this one render exposes nothing new.
  private safeNote(note: string): string {
    if (typeof window === 'undefined') return note
    if (this.adoptedServerRender && !this.hasUpdated) return note
    return DOMPurify.sanitize(note, PURIFY_OPTS) as unknown as string
  }

  override render() {
    const a = this.account
    if (!a) return nothing
    const headerImg = a.headerStatic || a.header
    // JSON.stringify gives a quoted CSS string, so a `)` or a quote in the
    // URL cannot close `url()` and start a declaration of its own.
    const banner = headerImg
      ? `background-image:url(${JSON.stringify(headerImg)});background-size:cover;`
      : nothing
    return html`
      <div class="banner" style=${banner}></div>
      <div class="row">
        <img class="avatar" src=${a.avatarStatic || a.avatar} alt="" loading="lazy" decoding="async" />
        <div>
          <div class="name">${a.displayName || a.username}</div>
          <div class="handle">@${a.acct}</div>
        </div>
      </div>
      <div class="bio">${unsafeHTML(this.safeNote(a.note ?? ''))}</div>
      <div class="counts">
        <span><strong>${a.statusesCount}</strong> Posts</span>
        <span><strong>${a.followingCount}</strong> Following</span>
        <span><strong>${a.followersCount}</strong> Followers</span>
      </div>
    `
  }
}
