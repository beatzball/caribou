import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { computed, effect, untracked } from '@preact/signals-core'
import type { mastodon } from 'masto'
import {
  activeClient, activeUser, createNotificationsStore, markNotificationsSeen, startPolling,
  unreadNotificationCount, NOTIFICATIONS_POLL_MS, type NotificationFilter, type NotificationsStore,
} from '@beatzball/caribou-state'
import { profilePath } from './_profile-path.js'
import { spaClick } from './_spa-link.js'
import type { IconName } from './caribou-icon.js'
import './caribou-button.js'
import './caribou-icon.js'
import './caribou-status-card.js'

type Notification = mastodon.v1.Notification

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
    /* Looks like the profile tabs; it is a toggle group, not navigation. */
    .filters button {
      padding: var(--space-3) var(--space-4); color: var(--fg-1);
      background: none; border: 0; border-bottom: 2px solid transparent;
      font: inherit; cursor: pointer;
    }
    .filters button[aria-pressed="true"] { color: var(--fg-0); border-bottom-color: var(--accent); }
    .filters button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { border-bottom: 1px solid var(--border); }
    .line {
      display: flex; align-items: center; gap: var(--space-2);
      padding: var(--space-3) var(--space-4) 0; color: var(--fg-1);
    }
    li.no-status .line { padding-bottom: var(--space-3); }
    .line caribou-icon { font-size: 18px; color: var(--accent); flex-shrink: 0; }
    .line a { color: var(--fg-0); font-weight: 600; text-decoration: none; }
    .line a:hover { text-decoration: underline; }
    .notice { padding: var(--space-4); color: var(--fg-muted); }
    [role="alert"] { padding: var(--space-4); color: var(--danger); }
    .inline-error { padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--border); }
    .more { display: flex; justify-content: center; padding: var(--space-4); }
  `

  @state() private filter: NotificationFilter = 'all'
  @state() private items: Notification[] = []
  @state() private loading = true
  @state() private errorMsg: string | null = null
  @state() private hasMore = false

  private store: NotificationsStore | null = null
  private disposeBindings: (() => void) | null = null
  private stopPolling: (() => void) | null = null
  private disposeSession: (() => void) | null = null
  private revealObserver: MutationObserver | null = null

  // The list belongs to one session. A new one starts the list again.
  private readonly session = computed(() => {
    const user = activeUser.value
    return user ? { userKey: user.userKey, id: `${user.userKey}\n${user.token}` } : null
  })

  override connectedCallback() {
    super.connectedCallback()
    let last: string | null | undefined
    this.disposeSession = effect(() => {
      const id = this.session.value?.id ?? null
      if (id === last) return
      last = id
      this.items = []
      untracked(() => this.open(this.filter))
    })
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  override disconnectedCallback() {
    this.disposeSession?.()
    this.disposeSession = null
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.close()
    super.disconnectedCallback()
  }

  private open(filter: NotificationFilter) {
    this.close()
    const session = this.session.peek()
    // A request made after the session changed gets no client, so it can
    // not mix another account's rows into this list.
    const clientSource = () => this.session.peek()?.id === session?.id ? activeClient.peek() : null
    const store = createNotificationsStore({ clientSource, filter })
    this.store = store
    this.disposeBindings = effect(() => {
      this.items = store.notifications.value
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
    const newest = this.items[0]
    if (session && newest) markNotificationsSeen(newest.id, session.userKey)
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
    this.open(filter)
  }

  private onRetry = () => {
    const store = this.store
    if (store) void store.load().then(() => this.markSeen(store))
  }
  private onMore = () => { void this.store?.loadMore() }

  // `acct` is relative to the user's own server for a local account.
  private profileHref(a: mastodon.v1.Account): string {
    return profilePath(a.acct, activeUser.value?.server ?? '')
  }

  private renderLine(icon: IconName, account: mastodon.v1.Account | undefined, text: string) {
    const name = account ? (account.displayName || account.username || account.acct) : ''
    const who = account
      ? html`<a href=${this.profileHref(account)} @click=${spaClick}>${name}</a>`
      : nothing
    return html`<div class="line">
      <caribou-icon name=${icon}></caribou-icon>
      <span>${who} <span class="what">${text}</span></span>
    </div>`
  }

  private renderItem(n: Notification) {
    // Read loosely: a server can send a type this build does not know, or
    // leave out a field its type says is there.
    const loose = n as { type: string; account?: mastodon.v1.Account; status?: mastodon.v1.Status | null }
    const status = loose.status ?? null
    // Notifications come from the user's own server, which is the instance
    // the card acts on.
    const card = status
      ? html`<caribou-status-card data-status-id=${status.id} .status=${status}
          instance=${activeUser.value?.server ?? ''}></caribou-status-card>`
      : nothing
    // A mention is its post. Without one it gets the generic line.
    if (loose.type === 'mention' && status) {
      return html`<li class="n-mention">${card}</li>`
    }
    const known = LINES[loose.type]
    const line = known
      ? this.renderLine(known.icon, loose.account, known.text)
      : this.renderLine('bell', loose.account, loose.account ? 'sent you a notification' : 'New notification')
    return html`<li class=${`n-${loose.type.replace(/[^a-z_]/gi, '')}${status ? '' : ' no-status'}`}>${line}${card}</li>`
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
    if (this.items.length === 0) {
      return html`<div class="notice">${FILTERS.find((f) => f.value === this.filter)!.empty}</div>`
    }
    return html`<div>
      ${this.errorMsg ? html`<div role="alert" class="inline-error">${this.errorMsg}</div>` : nothing}
      <ul>${repeat(this.items, (n) => n.id, (n) => this.renderItem(n))}</ul>
      ${this.hasMore
        ? html`<div class="more"><caribou-button ?loading=${this.loading} @click=${this.onMore}>Load older</caribou-button></div>`
        : nothing}
    </div>`
  }

  override render() {
    return html`<section aria-labelledby="notifications-h">
      <h1 id="notifications-h">Notifications</h1>
      <div class="filters" role="group" aria-label="Show">
        ${FILTERS.map((f) => html`<button type="button" aria-pressed=${f.value === this.filter ? 'true' : 'false'}
          data-filter=${f.value} @click=${() => this.onFilter(f.value)}>${f.label}</button>`)}
      </div>
      ${this.renderList()}
    </section>`
  }
}
