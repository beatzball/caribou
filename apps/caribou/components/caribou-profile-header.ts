import { LitElement, html, css, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import DOMPurify from 'dompurify'
import { effect, signal } from '@preact/signals-core'
import { PURIFY_OPTS, installPurifyHooks } from '@beatzball/caribou-mastodon-client/sanitize-opts'
import type { Account, Relationship } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUser, isOwnAccount, loadRelationship, relationshipCache, relationshipKey, toggleFollow,
  type UserSession,
} from '@beatzball/caribou-state'

// The same hooks as the server's sanitizer, so the two agree on every string.
// Without a window DOMPurify is a stub with no `addHook`; the server has its
// own instance.
if (typeof window !== 'undefined') installPurifyHooks(DOMPurify)

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
    .follows-you {
      display: inline-block; margin-top: var(--space-1); padding: 0 var(--space-2);
      border-radius: var(--radius-sm); background: var(--bg-2); color: var(--fg-muted); font-size: 0.85rem;
    }
    .actions { margin-left: auto; align-self: flex-start; }
    button.follow {
      min-width: 7.5rem; padding: var(--space-2) var(--space-3); border-radius: var(--radius-md);
      border: 1px solid var(--accent); background: var(--accent); color: var(--accent-fg);
      font: inherit; font-weight: 600; cursor: pointer;
    }
    button.follow[data-state="following"], button.follow[data-state="requested"] {
      background: transparent; color: var(--fg-0); border-color: var(--border);
    }
    /* "Following" reads as "Unfollow" under the pointer or keyboard focus,
       so the reader knows what a click will do before making it. */
    button.follow .hover { display: none; }
    button.follow[data-state="following"]:is(:hover, :focus-visible) .idle { display: none; }
    button.follow[data-state="following"]:is(:hover, :focus-visible) .hover { display: inline; }
  `

  @property({ attribute: false }) account: Account | null = null
  // The host the account came from, which is also the host its id belongs
  // to. Account ids are minted per instance, so a reader signed in elsewhere
  // has to look the account up on their own server before they can follow
  // it. Without it the header cannot tell, and shows no button.
  @property() instance = ''

  // What the follow button needs, known only after mount: the server has no
  // session. Both stay empty until then, so the first client render equals
  // the server's, which shows no button.
  @state() private target: Account | null = null
  @state() private relationship: Relationship | undefined = undefined

  // `target` as a signal too, so the effect that reads the relationship
  // cache picks up a new target.
  private targetSignal = signal<Account | null>(null)
  private dispose: (() => void) | null = null
  private resolveSeq = 0

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

  override connectedCallback() {
    super.connectedCallback()
    // Re-attach after a move in the DOM; the first attach is in firstUpdated.
    if (this.hasUpdated && !this.dispose) this.bind()
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.dispose = null
    super.disconnectedCallback()
  }

  protected override firstUpdated() {
    this.bind()
  }

  // Two triggers, one job. The effect in bind() re-resolves when the session
  // changes, but `account` and `instance` are Lit properties, not signals, so
  // the effect never sees them change; this re-resolves for those. Before
  // the first update bind() has not run, and its effect does the first
  // resolve itself.
  protected override willUpdate(changed: PropertyValues<this>) {
    if (this.hasUpdated && (changed.has('account') || changed.has('instance'))) {
      void this.resolveTarget(activeUser.value)
    }
  }

  private bind() {
    const disposeResolve = effect(() => { void this.resolveTarget(activeUser.value) })
    const disposeRead = effect(() => {
      const user = activeUser.value
      const target = this.targetSignal.value
      this.target = target
      this.relationship = user && target
        ? relationshipCache.value.get(relationshipKey(user.userKey, target.id))
        : undefined
    })
    this.dispose = () => { disposeResolve(); disposeRead() }
  }

  // Finds the account as the signed-in user's server knows it. Nothing to
  // find when nobody is signed in, or on the reader's own profile.
  private async resolveTarget(user: UserSession | null) {
    const seq = ++this.resolveSeq
    this.targetSignal.value = null
    const account = this.account
    const client = activeClient.value
    if (!user || !account || !client || !this.instance) return
    let target: Account | null = account
    if (!this.sameInstance(user.server)) {
      try {
        target = await client.lookupAccount(this.fullAcct(account))
      } catch {
        // The reader's server does not know the account: no button.
        target = null
      }
    }
    // A newer account, instance or session arrived while this one was
    // looking up.
    if (seq !== this.resolveSeq || !target || isOwnAccount(user, target)) return
    this.targetSignal.value = target
    void loadRelationship(target.id)
  }

  // Hosts are case-insensitive; `server` is a bare host, like `instance`.
  private sameInstance(server: string): boolean {
    return server.toLowerCase() === this.instance.toLowerCase()
  }

  // `acct` is relative to the instance the account came from: a local
  // account has no `@host` part.
  private fullAcct(a: Account): string {
    return a.acct.includes('@') ? a.acct : `${a.acct}@${this.instance}`
  }

  private onFollowClick = () => {
    if (this.target) void toggleFollow(this.target)
  }

  private renderFollow() {
    const rel = this.relationship
    if (!this.target || !rel) return nothing
    const state = rel.following ? 'following' : rel.requested ? 'requested' : 'follow'
    const label = state === 'following'
      ? html`<span class="idle">Following</span><span class="hover">Unfollow</span>`
      : state === 'requested' ? 'Requested' : 'Follow'
    // A live region, so a screen reader hears the new label after a click.
    return html`<div class="actions" aria-live="polite">
      <button type="button" class="follow" data-state=${state} @click=${this.onFollowClick}>${label}</button>
    </div>`
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
          ${this.relationship?.followedBy && this.target
            ? html`<span class="follows-you">Follows you</span>`
            : nothing}
        </div>
        ${this.renderFollow()}
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
