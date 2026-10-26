import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { effect } from '@preact/signals-core'
import type { mastodon } from 'masto'
import {
  activeClient, activeUser, createNotificationsStore, markNotificationsSeen, startPolling,
  NOTIFICATIONS_POLL_MS, type NotificationFilter, type NotificationsStore,
} from '@beatzball/caribou-state'
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

  override connectedCallback() {
    super.connectedCallback()
    this.open(this.filter)
  }

  override disconnectedCallback() {
    this.close()
    super.disconnectedCallback()
  }

  private open(filter: NotificationFilter) {
    this.close()
    const store = createNotificationsStore({ clientSource: () => activeClient.value, filter })
    this.store = store
    this.disposeBindings = effect(() => {
      this.items = store.notifications.value
      this.loading = store.loading.value
      this.errorMsg = store.error.value?.message ?? null
      this.hasMore = store.hasMore.value
    })
    void store.load().then(() => this.markSeen(store))
    this.stopPolling = startPolling({
      intervalMs: NOTIFICATIONS_POLL_MS,
      fn: () => store.poll().then(() => this.markSeen(store)),
    })
  }

  private close() {
    this.disposeBindings?.()
    this.disposeBindings = null
    this.stopPolling?.()
    this.stopPolling = null
    this.store = null
  }

  // Only the full list moves the marker: the newest mention can be newer
  // than a favourite the reader has not seen yet. The poll runs only while
  // the tab is visible, so what it shows is what the reader sees.
  private markSeen(store: NotificationsStore) {
    if (store !== this.store || this.filter !== 'all') return
    const newest = store.notifications.value[0]
    if (newest) markNotificationsSeen(newest.id)
  }

  private onFilter(filter: NotificationFilter) {
    if (filter === this.filter) return
    this.filter = filter
    this.items = []
    this.open(filter)
  }

  private onRetry = () => { void this.store?.load() }
  private onMore = () => { void this.store?.loadMore() }

  // `acct` is relative to the user's own server for a local account.
  private profileHref(a: mastodon.v1.Account): string {
    const host = activeUser.value?.server ?? ''
    return `/@${a.acct.includes('@') || !host ? a.acct : `${a.acct}@${host}`}`
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
    if (loose.type === 'mention') {
      return html`<li class="n-mention">${card}</li>`
    }
    const known = LINES[loose.type]
    const line = known
      ? this.renderLine(known.icon, loose.account, known.text)
      : this.renderLine('bell', loose.account, loose.account ? 'sent you a notification' : 'New notification')
    return html`<li class=${`n-${loose.type.replace(/[^a-z_]/gi, '')}${status ? '' : ' no-status'}`}>${line}${card}</li>`
  }

  private renderList() {
    if (this.errorMsg) {
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
