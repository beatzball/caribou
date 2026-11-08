import { LitElement, html, css, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import DOMPurify from 'dompurify'
import { effect, signal } from '@preact/signals-core'
import { PURIFY_OPTS, installPurifyHooks } from '@beatzball/caribou-mastodon-client/sanitize-opts'
import { canActOn, resourceNetwork, type Account, type Relationship } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUser, activeUserKey, isOwnAccount, loadRelationship, relationshipCache, relationshipKey,
  setBlock, setMute, toggleFollow, type UserSession,
} from '@beatzball/caribou-state'
import { mastodonLinkText } from './_shared-styles.js'
import { confirmBlock } from './caribou-confirm-dialog.js'
import { openListPicker } from './caribou-list-picker.js'
import './caribou-button.js'
import './caribou-menu.js'
import {
  BLUESKY_RETRY_EVENT, NO_UNAUTHENTICATED_NOTE, UNREADABLE, asksNoUnauthenticated, blueskyDecisionSettled, coverNote,
  currentBlueskyReader, decisionFits, isFailClosed, uiOf,
} from './_bluesky-moderation.js'

// The same hooks as the server's sanitizer, so the two agree on every string.
// Without a window DOMPurify is a stub with no `addHook`; the server has its
// own instance.
if (typeof window !== 'undefined') installPurifyHooks(DOMPurify)

@customElement('caribou-profile-header')
export class CaribouProfileHeader extends LitElement {
  static override styles = [mastodonLinkText, css`
    :host { display: block; border-bottom: 1px solid var(--border); }
    .banner { aspect-ratio: 3/1; background: var(--bg-2); }
    .row    { display: flex; gap: var(--space-3); padding: var(--space-3); }
    img.avatar { width: 80px; height: 80px; border-radius: var(--radius-md); flex-shrink: 0; }
    /* A Bluesky avatar or banner label (README, "Bluesky views"). */
    .banner.blurred, img.avatar.blurred { filter: blur(12px); }
    .banner.blurred { clip-path: inset(0); }
    .profile-cover .notice { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; color: var(--fg-muted); }
    .profile-cover .notice p { margin: 0; }
    .vh {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap;
    }
    p.profile-cover { padding: var(--space-3); margin: 0; color: var(--fg-muted); }
    .filter-toggle {
      padding: var(--space-1) var(--space-3); font: inherit; font-size: 0.875rem; font-weight: 600;
      cursor: pointer; color: var(--fg-0); background: var(--bg-2);
      border: 1px solid var(--border); border-radius: var(--radius-sm);
    }
    .filter-toggle:hover { background: var(--bg-1); }
    .filter-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .name   { color: var(--fg-0); font-weight: 600; font-size: 1.25rem; }
    .handle { color: var(--fg-muted); }
    .bio    { color: var(--fg-1); padding: 0 var(--space-3) var(--space-3); }
    .counts { display: flex; gap: var(--space-4); padding: 0 var(--space-3) var(--space-3); color: var(--fg-1); }
    .badges { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: var(--space-1); }
    .badge {
      display: inline-block; padding: 0 var(--space-2);
      border-radius: var(--radius-sm); background: var(--bg-2); color: var(--fg-muted); font-size: 0.85rem;
    }
    .badge.warn { color: var(--danger); }
    .actions { margin-left: auto; align-self: flex-start; display: flex; gap: var(--space-1); align-items: center; }
    .menu-item {
      display: block; inline-size: 100%; padding: var(--space-2) var(--space-3);
      font: inherit; text-align: start; color: var(--fg-1); background: none;
      border: 0; border-radius: var(--radius-sm); cursor: pointer;
    }
    .menu-item:hover { background: var(--bg-1); }
    .menu-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .menu-item.danger { color: var(--danger); }
    caribou-button.follow { min-width: 7.5rem; font-weight: 600; }
    /* "Following" reads as "Unfollow" under the pointer or keyboard focus,
       so the reader knows what a click will do before making it. The
       labels are slotted, so these rules reach them from here. */
    caribou-button.follow .hover { display: none; }
    caribou-button.follow[data-state="following"]:is(:hover, [data-focus-visible]) .idle { display: none; }
    caribou-button.follow[data-state="following"]:is(:hover, [data-focus-visible]) .hover { display: inline; }
  `]

  @property({ attribute: false }) account: Account | null = null
  // The host the account came from, which is also the host its id belongs
  // to. Account ids are minted per instance, so a reader signed in elsewhere
  // has to look the account up on their own server before they can follow
  // it. Without it the header cannot tell, and shows no button.
  @property() instance = ''
  // Whose decision a Bluesky account's `moderation` is: the user key of the
  // reader that looked it up, or null for no reader (the server's copy).
  // README, "A decision belongs to one reader".
  @property({ attribute: false }) viewerOf: string | null = null

  // The reader a Bluesky decision must be made for. Null until mount, as on
  // the server, which knows no reader.
  @state() private blueskyReaderKey: string | null = null
  // The reader chose Show on a profile covered by a label.
  @state() private profileShown = false
  // A Bluesky account's decision is settled for the reader
  // (`blueskyDecisionSettled`: theirs, every subscribed labeler covered).
  // True until mount, as on the server.
  @state() private profileSettled = true
  // The account as a Retry fetched it through the reader, with that reader.
  // It stands in for `account` while it is the same account.
  @state() private refreshed: { account: Account; viewerOf: string } | null = null
  @state() private profileRetrying = false

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
  // Untyped: `refreshed` is private, so it is not a key of `this`.
  protected override willUpdate(changed: PropertyValues) {
    if (changed.has('account') && changed.get('account') !== undefined) {
      this.profileShown = false
      this.refreshed = null
    }
    if (this.hasUpdated && (changed.has('account') || changed.has('instance'))) {
      void this.resolveTarget(activeUser.value)
    }
    // `account`, `viewerOf` and `refreshed` are not signals: the veil effect
    // does not see them change.
    if (this.hasUpdated && (changed.has('account') || changed.has('viewerOf') || changed.has('refreshed'))) this.syncSettled()
  }

  // The account shown and whose decision it carries.
  private shownAccount(): { account: Account | null; viewerOf: string | null } {
    const r = this.refreshed
    return r && r.account.id === this.account?.id ? r : { account: this.account, viewerOf: this.viewerOf }
  }

  private syncSettled() {
    const { account, viewerOf } = this.shownAccount()
    const settled = account?.bluesky
      ? blueskyDecisionSettled({ viewerOf, moderation: account.bluesky.moderation ?? null }, activeClient.value)
      : true
    if (settled !== this.profileSettled) this.profileSettled = settled
  }

  // Asks the session glue to reload label definitions, and fetches the
  // account again through the current reader.
  private onRetryProfile = async () => {
    const account = this.shownAccount().account
    if (!account || this.profileRetrying) return
    window.dispatchEvent(new CustomEvent(BLUESKY_RETRY_EVENT, { detail: { id: account.id } }))
    const client = activeClient.peek()
    if (!client || client.capabilities.network !== 'bluesky') return
    this.profileRetrying = true
    try {
      const fresh = await client.lookupAccount(account.id)
      if (activeClient.peek() === client && fresh?.id === this.account?.id) {
        this.refreshed = { account: fresh, viewerOf: client.userKey }
      }
    } catch {
      // Still covered, with Retry.
    } finally {
      this.profileRetrying = false
    }
  }

  private bind() {
    const disposeResolve = effect(() => { void this.resolveTarget(activeUser.value) })
    // The reader, their prefs and their label definitions are signals.
    const disposeVeil = effect(() => { this.syncSettled() })
    const disposeRead = effect(() => {
      this.blueskyReaderKey = currentBlueskyReader(activeClient.value)
      const user = activeUser.value
      const target = this.targetSignal.value
      this.target = target
      this.relationship = user && target
        ? relationshipCache.value.get(relationshipKey(user.userKey, target.id))
        : undefined
    })
    this.dispose = () => { disposeResolve(); disposeVeil(); disposeRead() }
  }

  // Finds the account as the signed-in user's server knows it. Nothing to
  // find when nobody is signed in, or on the reader's own profile.
  private async resolveTarget(user: UserSession | null) {
    const seq = ++this.resolveSeq
    this.targetSignal.value = null
    const account = this.account
    const client = activeClient.value
    // Only a client on the account's own network reads its relationship
    // or follows it (spec section 11).
    if (!user || !account || !client || !canActOn(client, account)) return
    const mastodon = resourceNetwork(account) === 'mastodon'
    if (mastodon && !this.instance) return
    let target: Account | null = account
    // A Bluesky DID is the same for every account: nothing to look up.
    if (mastodon && !this.sameInstance(user.server)) {
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

  private onMute = () => {
    if (this.target) void setMute(this.target, this.relationship?.muting !== true)
  }

  private onBlock = async () => {
    const target = this.target
    const client = activeClient.peek()
    const userKey = activeUserKey.peek()
    if (!target || !client) return
    const opts = { clientSource: () => client }
    if (this.relationship?.blocking) {
      void setBlock(target, false, opts)
      return
    }
    const ok = await confirmBlock(target.acct)
    // The target's id belongs to the server of the account that asked.
    if (ok && activeUserKey.peek() === userKey && this.target === target) void setBlock(target, true, opts)
  }

  // The item that opened the picker sits in the closed menu, so focus goes
  // back to the menu's button.
  private onLists = async () => {
    if (!this.target) return
    await openListPicker(this.target, this.relationship?.following === true)
    this.renderRoot.querySelector<HTMLElement>('caribou-menu.more')?.focus()
  }

  private renderMenu(rel: Relationship) {
    const acct = this.target!.acct
    // Native buttons: items in a <caribou-menu>.
    return html`<caribou-menu class="more" anchored icon="ellipsis" label=${`More actions for @${acct}`}>
      <button type="button" class="menu-item" data-action="lists" @click=${this.onLists}>Add to lists</button>
      <button type="button" class="menu-item" data-action="mute"
        @click=${this.onMute}>${rel.muting ? 'Unmute' : 'Mute'} @${acct}</button>
      <button type="button" class=${rel.blocking ? 'menu-item' : 'menu-item danger'} data-action="block"
        @click=${this.onBlock}>${rel.blocking ? 'Unblock' : 'Block'} @${acct}</button>
    </caribou-menu>`
  }

  // The host matches `:focus` but not `:focus-visible` when its inner button
  // has focus, so ask the inner button and mark the host for the CSS. A
  // mouse click focuses the button too, and must not keep "Unfollow" up.
  // A key pressed while it keeps focus turns `:focus-visible` on with no
  // focus event, so key events ask again (keyup: after the browser flips it).
  private onFollowFocus = (e: Event) => {
    const host = e.currentTarget as HTMLElement
    const inner = e.composedPath()[0] as Element
    host.toggleAttribute('data-focus-visible', e.type !== 'focusout' && inner.matches(':focus-visible'))
  }

  // One template for every state, so the button the reader pressed (Follow,
  // Unfollow or Unblock) stays the same element and keeps focus. A blocked
  // account cannot be followed: the button then unblocks.
  private renderFollow() {
    const rel = this.relationship
    if (!this.target || !rel) return nothing
    const state = rel.blocking ? 'blocked' : rel.following ? 'following' : rel.requested ? 'requested' : 'follow'
    const label = state === 'following'
      ? html`<span class="idle">Following</span><span class="hover">Unfollow</span>`
      : state === 'blocked' ? 'Unblock' : state === 'requested' ? 'Requested' : 'Follow'
    // A live region, so a screen reader hears the new label after a click.
    return html`<div class="actions" aria-live="polite">
      <caribou-button class="follow" data-state=${state} variant=${state === 'follow' ? 'primary' : 'secondary'}
        @click=${state === 'blocked' ? this.onBlock : this.onFollowClick}
        @focusin=${this.onFollowFocus} @focusout=${this.onFollowFocus}
        @keydown=${this.onFollowFocus} @keyup=${this.onFollowFocus}
        >${label}</caribou-button>
      ${this.renderMenu(rel)}
    </div>`
  }

  private renderBadges() {
    const rel = this.relationship
    if (!rel || !this.target) return nothing
    const badges = [
      rel.followedBy ? html`<span class="badge follows-you">Follows you</span>` : nothing,
      rel.muting ? html`<span class="badge muted">Muted</span>` : nothing,
      rel.blocking ? html`<span class="badge warn blocked">Blocked</span>` : nothing,
    ]
    if (!rel.followedBy && !rel.muting && !rel.blocking) return nothing
    return html`<div class="badges">${badges}</div>`
  }

  override render() {
    const { account: a, viewerOf } = this.shownAccount()
    if (!a) return nothing
    const headerImg = a.headerStatic || a.header
    // JSON.stringify gives a quoted CSS string, so a `)` or a quote in the
    // URL cannot close `url()` and start a declaration of its own.
    const banner = headerImg
      ? `background-image:url(${JSON.stringify(headerImg)});background-size:cover;`
      : nothing
    // A Bluesky account: covers compose and the strictest wins (README,
    // "Bluesky views"). Only a decision made for the current reader counts;
    // no fitting decision blurs the pictures and covers the profile. A
    // Mastodon account has no `bluesky` field.
    const bsky = a.bluesky
    const reader = this.blueskyReaderKey
    if (bsky && reader === null && asksNoUnauthenticated(a)) {
      return html`<div class="banner blurred"></div>
        <p class="profile-cover notice">${NO_UNAUTHENTICATED_NOTE}</p>`
    }
    const mod = bsky && decisionFits(viewerOf, reader) && this.profileSettled ? bsky.moderation : undefined
    const blurAvatar = !!bsky && (!mod || uiOf(mod, 'avatar')!.blur)
    const blurBanner = !!bsky && (!mod || uiOf(mod, 'banner')!.blur)
    const view = bsky ? (mod ? uiOf(mod, 'profileView')! : UNREADABLE) : null
    if (view && (view.blur || view.filter)) {
      const note = mod ? coverNote(view) : 'Checking this profile against your moderation settings…'
      const canShow = !!mod && !view.noOverride
      const shown = canShow && this.profileShown
      // Retry fetches as the reader: with no Bluesky reader there is none.
      const retry = reader !== null && (!mod || view.reasons.some(isFailClosed))
      return html`
        <div class=${blurBanner ? 'banner blurred' : 'banner'} style=${banner}></div>
        <div class="profile-cover">
          <div class="row">
            <img class=${blurAvatar ? 'avatar blurred' : 'avatar'} src=${a.avatarStatic || a.avatar} alt="" loading="lazy" decoding="async" />
            <div class="notice">
              <p>${note}</p>
              ${canShow
                ? html`<button type="button" class="filter-toggle" aria-controls="profile-covered"
                    aria-expanded=${shown ? 'true' : 'false'}
                    aria-label=${`${shown ? 'Hide' : 'Show'} profile with a label: ${note}`}
                    @click=${this.onToggleProfile}>${shown ? 'Hide' : 'Show'}</button>`
                : nothing}
              ${retry
                ? html`<caribou-button class="retry" variant="secondary" ?loading=${this.profileRetrying}
                    @click=${this.onRetryProfile}>Retry<span class="vh"> checking this profile</span></caribou-button>`
                : nothing}
            </div>
          </div>
          ${canShow
            ? html`<div id="profile-covered" ?hidden=${!shown}>${shown ? this.renderIdentity(a) : nothing}</div>`
            : nothing}
        </div>
      `
    }
    return html`
      <div class=${blurBanner ? 'banner blurred' : 'banner'} style=${banner}></div>
      <div class="row">
        <img class=${blurAvatar ? 'avatar blurred' : 'avatar'} src=${a.avatarStatic || a.avatar} alt="" loading="lazy" decoding="async" />
        <div>
          <div class="name">${a.displayName || a.username}</div>
          <div class="handle">@${a.acct}</div>
          ${this.renderBadges()}
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

  private onToggleProfile = () => { this.profileShown = !this.profileShown }

  // What a profile cover hides: name, handle, badges, follow, bio, counts.
  // One element around it all: happy-dom drops a child binding at the top
  // level of a template (README, Tests).
  private renderIdentity(a: Account) {
    return html`<div class="identity">
      <div class="row">
        <div>
          <div class="name">${a.displayName || a.username}</div>
          <div class="handle">@${a.acct}</div>
          ${this.renderBadges()}
        </div>
        ${this.renderFollow()}
      </div>
      <div class="bio">${unsafeHTML(this.safeNote(a.note ?? ''))}</div>
      <div class="counts">
        <span><strong>${a.statusesCount}</strong> Posts</span>
        <span><strong>${a.followingCount}</strong> Following</span>
        <span><strong>${a.followersCount}</strong> Followers</span>
      </div>
    </div>`
  }
}
