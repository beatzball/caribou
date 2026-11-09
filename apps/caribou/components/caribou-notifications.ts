import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { computed, effect, untracked } from '@preact/signals-core'
import type { Account } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUser, compareNotificationIds, createNotificationsStore, isBlueskySession,
  markBlueskyNotificationsSeen, markNotificationsSeen, relationshipCache,
  startPolling, unreadNotificationCount, withoutSilencedAccounts, NOTIFICATIONS_POLL_MS,
  type NotificationFilter, type NotificationGroup, type NotificationsStore,
} from '@beatzball/caribou-state'
import { accountPath } from './_profile-path.js'
import { blueskyDecisionSettled, coverNote, uiOf, UNREADABLE } from './_bluesky-moderation.js'
import { spaClick } from './_spa-link.js'
import type { IconName } from './caribou-icon.js'
import './caribou-button.js'
import './caribou-icon.js'
import './caribou-status-card.js'

const FILTERS: { value: NotificationFilter; label: string; empty: string }[] = [
  { value: 'all',      label: 'All',      empty: 'No notifications yet.' },
  { value: 'mentions', label: 'Mentions', empty: 'No mentions yet.' },
]

// What each type says, after the account's name. A type that is not here
// (the server adds new ones over time) gets the generic line.
const LINES: Partial<Record<string, { icon: IconName; text: string }>> = {
  status:         { icon: 'bell',        text: 'posted' },
  favourite:      { icon: 'star',        text: 'favourited your post' },
  reblog:         { icon: 'repeat2',     text: 'boosted your post' },
  follow:         { icon: 'userPlus',    text: 'followed you' },
  follow_request: { icon: 'userPlus',    text: 'asked to follow you' },
  poll:           { icon: 'chartColumn', text: 'ran a poll that has ended' },
  update:         { icon: 'squarePen',   text: 'edited a post you interacted with' },
}

// An author whose decision is not settled yet (the reader veil).
const CHECKING_AUTHOR = 'checking your moderation settings'

// Bluesky says like and repost, not favourite and boost.
const BLUESKY_LINES: Partial<Record<string, { icon: IconName; text: string }>> = {
  favourite: { icon: 'star',    text: 'liked your post' },
  reblog:    { icon: 'repeat2', text: 'reposted your post' },
}

/**
 * The notifications list. It renders only in the browser: the page shows
 * it once it has read the session, which the server never has.
 */
@customElement('caribou-notifications')
export class CaribouNotifications extends LitElement {
  /** How often the open list asks for new ones. A test can make it short. */
  static pollMs = NOTIFICATIONS_POLL_MS

  static override styles = css`
    :host { display: block; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0; padding: 0 var(--space-4) var(--space-3); }
    .filters { display: flex; border-bottom: 1px solid var(--border); }
    /* Shared toggles drawn like the profile tabs: a toggle group, not
       navigation, so not <caribou-tabs>. */
    .filters caribou-button::part(button) {
      min-block-size: 0; padding: var(--space-3) var(--space-4); color: var(--fg-1);
      background: none; border: 0; border-bottom: 2px solid transparent; border-radius: 0;
    }
    .filters caribou-button[pressed="true"]::part(button) { color: var(--fg-0); border-bottom-color: var(--accent); }
    .filters caribou-button::part(button):focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    ul { list-style: none; margin: 0; padding: 0; }
    /* A post hidden by a filter, a mute or a block takes its notification with it. */
    .rows > li:has(caribou-status-card[hidden]) { display: none; }
    .rows > li { border-bottom: 1px solid var(--border); }
    .line {
      display: flex; align-items: center; gap: var(--space-2);
      padding: var(--space-3) var(--space-4) 0; color: var(--fg-1);
    }
    li.no-status:not(.grouped) .line { padding-bottom: var(--space-3); }
    .line caribou-icon { font-size: 18px; color: var(--accent); flex-shrink: 0; }
    .line a { color: var(--fg-0); font-weight: 600; text-decoration: none; }
    .line a:hover { text-decoration: underline; }
    .line > span { min-width: 0; overflow-wrap: anywhere; }
    /* The faces in a group, overlapping, newest first. */
    .avatars { display: flex; padding: var(--space-2) var(--space-4) 0 calc(var(--space-4) + 18px + var(--space-2)); }
    .avatars img {
      width: 28px; height: 28px; border-radius: 50%; object-fit: cover;
      background: var(--bg-2); border: 2px solid var(--bg-0);
    }
    .avatars img + img { margin-left: -8px; }
    /* A Bluesky author whose avatar the reader's settings blur (spec 7.4). */
    img.blurred { filter: blur(6px); }
    .expand {
      margin-left: auto; flex-shrink: 0; padding: var(--space-1) var(--space-2);
      color: var(--fg-1); background: none; border: 1px solid var(--border); border-radius: 999px;
      font: inherit; font-size: 0.875rem; cursor: pointer;
    }
    .expand:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .who { list-style: none; margin: 0; padding: var(--space-2) var(--space-4) 0 calc(var(--space-4) + 18px + var(--space-2)); }
    .who li { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) 0; }
    .who img { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; }
    .who a { color: var(--fg-0); text-decoration: none; overflow-wrap: anywhere; }
    .who a:hover { text-decoration: underline; }
    .who .rest { color: var(--fg-muted); }
    .rows > li.no-status.grouped .group-body { padding-bottom: var(--space-3); }
    .notice { padding: var(--space-4); color: var(--fg-muted); }
    [role="alert"] { padding: var(--space-4); color: var(--danger); }
    .inline-error { padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--border); }
    .more { display: flex; justify-content: center; padding: var(--space-4); }
  `

  @state() private filter: NotificationFilter = 'all'
  @state() private items: NotificationGroup[] = []
  // The groups whose list of accounts is open, by group key.
  @state() private expanded: ReadonlySet<string> = new Set()
  // Everyone in a server group, loaded when its list is opened. A server
  // group comes with a sample only. Each list is for the group as it was at
  // `newestId`: once a poll adds to the group, the list is loaded again.
  // Cleared with the session.
  @state() private everyone: ReadonlyMap<string, { newestId: string; accounts: Account[] }> = new Map()
  @state() private loadingWho: ReadonlySet<string> = new Set()
  @state() private failedWho: ReadonlySet<string> = new Set()
  // Every session change, A -> B -> A too, starts a new activation; each
  // list request has its own number. An answer for an older one is dropped.
  private whoActivation = 0
  private whoSeq = 0
  private readonly whoRequest = new Map<string, number>()
  // The accounts the reader mutes or blocks, by id on the reader's server.
  // Their notifications leave the list at once, as Mastodon's own do, and
  // come back if the mute fails.
  @state() private silenced: ReadonlySet<string> = new Set()
  private disposeSilenced: (() => void) | null = null
  @state() private loading = true
  @state() private errorMsg: string | null = null
  @state() private hasMore = false
  // A Load older click ended the list: the end notice shows and takes focus,
  // so focus does not fall to the body with the removed button.
  @state() private endedHere = false
  // Bumped when the reader veil's inputs change (reader, prefs, label
  // definitions, the check): author decisions are judged again.
  @state() private veilTick = 0
  private disposeVeil: (() => void) | null = null

  private store: NotificationsStore | null = null
  private disposeBindings: (() => void) | null = null
  private stopPolling: (() => void) | null = null
  private disposeSession: (() => void) | null = null
  private revealObserver: MutationObserver | null = null

  // The list belongs to one session. A new one starts the list again. A
  // Bluesky session has no token: its sign-in is its `generation`.
  private readonly session = computed(() => {
    const user = activeUser.value
    if (!user) return null
    const bluesky = isBlueskySession(user)
    return {
      userKey: user.userKey,
      generation: user.generation,
      bluesky,
      id: `${user.userKey}\n${bluesky ? user.generation : user.token}`,
    }
  })

  override connectedCallback() {
    super.connectedCallback()
    let last: string | null | undefined
    this.disposeSession = effect(() => {
      const id = this.session.value?.id ?? null
      if (id === last) return
      last = id
      this.items = []
      // Group keys are not per account (`follow-<hour>`): nothing open or
      // loaded carries over to the next one.
      this.expanded = new Set()
      this.everyone = new Map()
      this.loadingWho = new Set()
      this.failedWho = new Set()
      this.whoActivation++
      this.whoRequest.clear()
      untracked(() => this.open(this.filter))
    })
    // `blueskyDecisionSettled` reads the veil's signals; following it here
    // renders the authors again when any of them changes.
    this.disposeVeil = effect(() => {
      blueskyDecisionSettled(null, activeClient.value)
      untracked(() => { this.veilTick++ })
    })
    this.disposeSilenced = effect(() => {
      const prefix = `${this.session.value?.userKey ?? ''} `
      const ids = new Set<string>()
      for (const [key, rel] of relationshipCache.value) {
        if (key.startsWith(prefix) && (rel.muting || rel.blocking)) ids.add(key.slice(prefix.length))
      }
      const same = ids.size === this.silenced.size && [...ids].every((id) => this.silenced.has(id))
      if (!same) this.silenced = ids
    })
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  override disconnectedCallback() {
    this.disposeSession?.()
    this.disposeSession = null
    this.disposeSilenced?.()
    this.disposeSilenced = null
    this.disposeVeil?.()
    this.disposeVeil = null
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.close()
    super.disconnectedCallback()
  }

  private open(filter: NotificationFilter) {
    this.close()
    this.endedHere = false
    const session = this.session.peek()
    // A request made after the session changed gets no client, so it can
    // not mix another account's rows into this list.
    const clientSource = () => this.session.peek()?.id === session?.id ? activeClient.peek() : null
    const store = createNotificationsStore({ clientSource, filter })
    this.store = store
    this.disposeBindings = effect(() => {
      this.items = store.groups.value
      this.loading = store.loading.value
      this.errorMsg = store.error.value?.message ?? null
      this.hasMore = store.hasMore.value
    })
    void store.load().then(() => this.markSeen(store))
    const poll = () => store.poll().then(() => this.markSeen(store))
    this.stopPolling = startPolling({ intervalMs: CaribouNotifications.pollMs, fn: poll })
    // The app-wide poll found something new: show it here too, so the
    // badge and the list agree. A count that comes in during a load is
    // handled when the load ends.
    const stopUnread = effect(() => {
      if (unreadNotificationCount.value > 0 && !store.loading.value) untracked(() => void poll())
    })
    const stopTimer = this.stopPolling
    this.stopPolling = () => { stopTimer(); stopUnread() }
  }

  private close() {
    this.revealObserver?.disconnect()
    this.revealObserver = null
    this.disposeBindings?.()
    this.disposeBindings = null
    this.stopPolling?.()
    this.stopPolling = null
    this.store = null
  }

  // Only the full list moves the marker: the newest mention can be newer
  // than a favourite the reader has not seen yet. It moves only to a row
  // that is on screen, in a visible tab, for the session the list is for.
  // A tab that is hidden now marks seen when it is shown again. So does a
  // page the router has added but not shown yet.
  private async markSeen(store: NotificationsStore | null) {
    if (!store) return
    await this.updateComplete
    if (store !== this.store || this.filter !== 'all') return
    if (document.visibilityState !== 'visible') return
    const hidden = this.hiddenAncestor()
    if (hidden) {
      this.markSeenOnReveal(hidden)
      return
    }
    const session = this.session.peek()
    // Bluesky: the server keeps what was seen (`updateSeen`), from what the
    // list read (state README, "Notifications").
    if (session?.bluesky) {
      void markBlueskyNotificationsSeen({ userKey: session.userKey, generation: session.generation, hint: store.seen.peek() })
      return
    }
    let newest: string | undefined
    for (const g of this.items) if (!newest || compareNotificationIds(g.newestId, newest) > 0) newest = g.newestId
    if (session && newest) markNotificationsSeen(newest, session.userKey)
  }

  // The router adds the next page with `hidden`, lets it render, then shows
  // it, or removes it when a newer navigation wins. Walks out of shadow roots.
  private hiddenAncestor(): Element | null {
    if (this.hasAttribute('hidden')) return this
    let node: Node | null = this.parentNode
    while (node) {
      if (node instanceof Element && node.hasAttribute('hidden')) return node
      node = node instanceof ShadowRoot ? node.host : node.parentNode
    }
    return null
  }

  private markSeenOnReveal(hidden: Element) {
    this.revealObserver?.disconnect()
    const observer = new MutationObserver(() => {
      if (hidden.hasAttribute('hidden')) return
      observer.disconnect()
      if (this.revealObserver === observer) this.revealObserver = null
      void this.markSeen(this.store)
    })
    observer.observe(hidden, { attributes: true, attributeFilter: ['hidden'] })
    this.revealObserver = observer
  }

  private onVisibility = () => { void this.markSeen(this.store) }

  private onFilter(filter: NotificationFilter) {
    if (filter === this.filter) return
    this.filter = filter
    this.items = []
    this.expanded = new Set()
    this.open(filter)
  }

  private onRetry = () => {
    const store = this.store
    this.endedHere = false
    if (store) void store.load().then(() => this.markSeen(store))
  }

  // Focus is still the reader's "Load older" (or fell to the body when the
  // button went): only then may the end notice take it.
  private focusIsFree(): boolean {
    const outer = document.activeElement
    if (outer === null || outer === document.body) return true
    if (outer !== this) return false
    const inner = this.shadowRoot?.activeElement ?? null
    return inner === null || inner.closest('.more') !== null
  }

  private onMore = async () => {
    const store = this.store
    if (!store) return
    await store.loadMore()
    if (store !== this.store || store.hasMore.peek() || !this.focusIsFree()) {
      if (store === this.store && !store.hasMore.peek()) this.endedHere = true
      return
    }
    this.endedHere = true
    await this.updateComplete
    if (!this.focusIsFree()) return
    ;(this.shadowRoot?.querySelector('.notice.end') as HTMLElement | null)?.focus()
  }

  // `acct` is relative to the user's own server for a local account. A
  // Bluesky account is its handle, with no host.
  private profileHref(a: Account): string {
    return accountPath(a, activeUser.value?.server ?? '')
  }

  private name(a: Account): string {
    return a.displayName || a.username || a.acct
  }

  // What the reader's settings say about a Bluesky author in a list
  // (spec 7.4): `contentList` filters the author out or covers the name,
  // `avatar` blurs the face. No decision fails closed. A Mastodon account
  // has none of this.
  // The decision counts only once it is settled for this reader, as on the
  // card and the profile header (`blueskyDecisionSettled`: made for this
  // reader, every subscribed labeler covered). Until then the author is
  // covered. The list belongs to one sign-in, so its decisions are that
  // reader's.
  private authorUi(a: Account): { filter: boolean; cover: string | null; blurAvatar: boolean } {
    if (!a.bluesky) return { filter: false, cover: null, blurAvatar: false }
    void this.veilTick
    const mod = a.bluesky.moderation ?? null
    const reader = this.session.peek()?.userKey ?? null
    if (mod && !blueskyDecisionSettled({ viewerOf: reader, moderation: mod }, activeClient.peek())) {
      return { filter: false, cover: CHECKING_AUTHOR, blurAvatar: true }
    }
    const list = mod ? uiOf(mod, 'contentList')! : UNREADABLE
    const avatar = mod ? uiOf(mod, 'avatar')! : UNREADABLE
    return { filter: list.filter, cover: list.blur ? coverNote(list) : null, blurAvatar: avatar.blur }
  }

  // A covered author has no name and no link, only the reason.
  private nameLink(a: Account) {
    const cover = this.authorUi(a).cover
    if (cover) return html`<span class="covered">Someone (${cover})</span>`
    return html`<a href=${this.profileHref(a)} @click=${spaClick}>${this.name(a)}</a>`
  }

  // A covered author's face is blurred too: it would name them.
  private face(a: Account) {
    const ui = this.authorUi(a)
    return html`<img class=${ui.blurAvatar || ui.cover !== null ? 'blurred' : nothing} src=${a.avatarStatic || a.avatar} alt="" loading="lazy">`
  }

  // "Alice", "Alice and Bob", "Alice, Bob and 12 others": two names at most.
  private renderWho(g: NotificationGroup) {
    const shown = g.accounts.slice(0, 2)
    const others = Math.max(0, g.count - shown.length)
    // Every name in the sample is muted or blocked; the rest still count.
    if (shown.length === 0) {
      if (g.complete) return nothing
      return g.count > 1 ? `${g.count} people` : 'Someone'
    }
    const links = shown.map((a) => this.nameLink(a))
    if (others === 0) return links.length === 1 ? links : [links[0], ' and ', links[1]]
    const rest = `${others} ${others === 1 ? 'other' : 'others'}`
    return links.length === 1 ? [links[0], ` and ${rest}`] : [links[0], ', ', links[1], ` and ${rest}`]
  }

  private toggle(g: NotificationGroup) {
    const next = new Set(this.expanded)
    const opening = !next.has(g.key)
    if (opening) next.add(g.key)
    else next.delete(g.key)
    this.expanded = next
    // Opening also retries a list that failed.
    if (opening && this.needsEveryone(g)) void this.loadEveryone(g)
  }

  // A group with only a sample whose list is missing or older than the group.
  private needsEveryone(g: NotificationGroup): boolean {
    return !g.complete && this.everyone.get(g.key)?.newestId !== g.newestId && !this.loadingWho.has(g.key)
  }

  // An open list whose group grew in a poll loads again. One that failed
  // waits for the reader to open it again, so a failure does not repeat.
  protected override willUpdate() {
    for (const g of this.items) {
      if (this.expanded.has(g.key) && !this.failedWho.has(g.key) && this.needsEveryone(g)) void this.loadEveryone(g)
    }
  }

  private static without<T>(set: ReadonlySet<T>, value: T): Set<T> {
    const next = new Set(set)
    next.delete(value)
    return next
  }

  private async loadEveryone(g: NotificationGroup) {
    const { key, newestId } = g
    const client = activeClient.peek()
    if (!this.session.peek() || !client) return
    const activation = this.whoActivation
    const request = ++this.whoSeq
    this.whoRequest.set(key, request)
    this.loadingWho = new Set([...this.loadingWho, key])
    this.failedWho = CaribouNotifications.without(this.failedWho, key)
    let accounts: Account[] | null = null
    try {
      accounts = await client.fetchNotificationGroupAccounts(key)
    } catch {
      accounts = null
    }
    // An answer from before a session change, or to an older request for
    // this group, changes nothing.
    if (activation !== this.whoActivation || this.whoRequest.get(key) !== request) return
    this.whoRequest.delete(key)
    this.loadingWho = CaribouNotifications.without(this.loadingWho, key)
    if (accounts) this.everyone = new Map([...this.everyone, [key, { newestId, accounts }]])
    else this.failedWho = new Set([...this.failedWho, key])
  }

  // A row with more than one person, or with people the sample left out
  // (the sample can be all muted, leaving one unnamed person), can list who.
  private expandable(g: NotificationGroup): boolean {
    return g.count > 1 || !g.complete
  }

  private renderLine(icon: IconName, g: NotificationGroup, text: string) {
    const many = this.expandable(g)
    const open = this.expanded.has(g.key)
    // Native (README exception): its aria-controls names the list of who in
    // this root, which a shared control's inner button could not reach.
    return html`<div class="line">
      <caribou-icon name=${icon}></caribou-icon>
      <span>${this.renderWho(g)} <span class="what">${text}</span></span>
      ${many
        ? html`<button type="button" class="expand" aria-expanded=${open ? 'true' : 'false'}
            aria-controls=${open ? this.whoId(g) : nothing}
            aria-label=${open ? `Hide who ${text}` : `Show all ${g.count} who ${text}`}
            @click=${() => this.toggle(g)}>${open ? 'Hide' : 'Show all'}</button>`
        : nothing}
    </div>`
  }

  // The faces in a group and, once opened, the list of who.
  private renderGroupBody(g: NotificationGroup) {
    if (!this.expandable(g)) return nothing
    const open = this.expanded.has(g.key)
    return html`<div class="group-body">
      <div class="avatars" aria-hidden="true">
        ${g.accounts.slice(0, 8).map((a) => this.face(a))}
      </div>
      ${open ? this.renderAccounts(g, this.whoId(g)) : nothing}
    </div>`
  }

  private whoId(g: NotificationGroup): string {
    return `who-${g.key.replace(/[^a-z0-9_-]/gi, '_')}`
  }

  // Everyone, once loaded; until then, or when the load failed, the sample.
  private renderAccounts(g: NotificationGroup, id: string) {
    const entry = this.everyone.get(g.key)
    const loaded = entry && entry.newestId === g.newestId ? entry.accounts : null
    const accounts = loaded ? loaded.filter((a) => !this.silenced.has(a.id)) : g.accounts
    const more = loaded ? 0 : g.count - g.accounts.length
    const loading = this.loadingWho.has(g.key)
    const failed = this.failedWho.has(g.key)
    return html`<ul class="who" id=${id} aria-label="Who" aria-busy=${loading ? 'true' : 'false'}>
      ${accounts.map((a) => html`<li>
        ${this.face(a)}
        ${this.nameLink(a)}
      </li>`)}
      ${more > 0 && !loading ? html`<li class="rest">and ${more} more</li>` : nothing}
      ${loading ? html`<li class="rest" role="status">Loading everyone…</li>` : nothing}
      ${failed ? html`<li class="rest" role="alert">Could not load everyone. Hide and Show all to try again.</li>` : nothing}
    </ul>`
  }

  private renderItem(g: NotificationGroup) {
    const status = g.status
    // Notifications come from the user's own server, which is the instance
    // the card acts on.
    const card = status
      ? html`<caribou-status-card data-status-id=${status.id} .status=${status}
          instance=${activeUser.value?.server ?? ''} filter-context="notifications"></caribou-status-card>`
      : nothing
    // A mention is its post. Without one it gets the generic line.
    if (g.type === 'mention' && status) {
      return html`<li class="n-mention">${card}</li>`
    }
    const known = (this.session.value?.bluesky ? BLUESKY_LINES[g.type] : undefined) ?? LINES[g.type]
    const line = known
      ? this.renderLine(known.icon, g, known.text)
      : this.renderLine('bell', g, g.accounts.length > 0 ? 'sent you a notification' : 'New notification')
    const cls = `n-${g.type.replace(/[^a-z_]/gi, '')}${status ? '' : ' no-status'}${g.count > 1 ? ' grouped' : ''}`
    return html`<li class=${cls}>${line}${this.renderGroupBody(g)}${card}</li>`
  }

  private renderList() {
    // With rows on screen, a failed poll or Load older keeps them.
    if (this.errorMsg && this.items.length === 0) {
      return html`<div role="alert">
        ${this.errorMsg}
        <caribou-button @click=${this.onRetry}>Retry</caribou-button>
      </div>`
    }
    if (this.loading && this.items.length === 0) {
      return html`<div class="notice">Loading notifications…</div>`
    }
    // An empty page with a cursor is not the end (a Bluesky page of only
    // skipped notifications): older ones are still in reach.
    const empty = FILTERS.find((f) => f.value === this.filter)!.empty
    // Muted, blocked and (Bluesky) filtered authors leave their rows. The
    // notices go by what is left.
    const hidden = new Set(this.silenced)
    for (const g of this.items) for (const a of g.accounts) if (this.authorUi(a).filter) hidden.add(a.id)
    const shown = withoutSilencedAccounts(this.items, hidden)
    if (shown.length === 0 && !this.hasMore) {
      return html`<div>
        ${this.errorMsg ? html`<div role="alert" class="inline-error">${this.errorMsg}</div>` : nothing}
        <div class=${this.endedHere ? 'notice end' : 'notice'} tabindex=${this.endedHere ? '-1' : nothing}>${empty}</div>
      </div>`
    }
    return html`<div>
      ${this.errorMsg ? html`<div role="alert" class="inline-error">${this.errorMsg}</div>` : nothing}
      ${shown.length === 0
        ? html`<div class="notice">Nothing to show here yet. Older notifications may follow.</div>`
        : html`<ul class="rows">${repeat(shown, (g) => g.key, (g) => this.renderItem(g))}</ul>`}
      ${this.hasMore
        ? html`<div class="more"><caribou-button ?loading=${this.loading} @click=${this.onMore}>Load older</caribou-button></div>`
        : this.endedHere ? html`<div class="notice end" tabindex="-1">No older notifications.</div>` : nothing}
    </div>`
  }

  override render() {
    return html`<section aria-labelledby="notifications-h">
      <h1 id="notifications-h">Notifications</h1>
      <div class="filters" role="group" aria-label="Show">
        ${FILTERS.map((f) => html`<caribou-button pressed=${f.value === this.filter ? 'true' : 'false'}
          data-filter=${f.value} @click=${() => this.onFilter(f.value)}>${f.label}</caribou-button>`)}
      </div>
      ${this.renderList()}
    </section>`
  }
}
