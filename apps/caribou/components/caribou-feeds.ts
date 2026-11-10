import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { effect } from '@preact/signals-core'
import type { CaribouClient, SavedFeed } from '@beatzball/caribou-mastodon-client'
import { activeClient, loadSavedFeeds, savedFeedsFor } from '@beatzball/caribou-state'
import { boxReset } from './_shared-styles.js'
import { spaClick } from './_spa-link.js'
import { feedPath } from './_feed-path.js'
import './caribou-button.js'

// The reader's saved Bluesky feeds (#194; README, "Bluesky feeds"), in
// their order, each linking to its Home tab. Client only: the feeds need
// the reader's token. Read only: no pin, unpin or remove.
@customElement('caribou-feeds')
export class CaribouFeeds extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; padding: var(--space-4); }
    h1 { font-size: 1.5rem; margin: 0 0 var(--space-3); }
    ul { list-style: none; margin: 0; padding: 0; }
    li {
      display: flex; align-items: flex-start; gap: var(--space-3);
      border-bottom: 1px solid var(--border); padding: var(--space-3) 0;
    }
    img, .no-avatar {
      flex: none; inline-size: 2.75rem; block-size: 2.75rem; border-radius: var(--radius-2, 8px);
      background: var(--bg-2); object-fit: cover;
    }
    .text { flex: 1; min-inline-size: 0; }
    .name { color: var(--fg-0); font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
    a.name:hover { text-decoration: underline; }
    a.name:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .by, .desc, .gone { margin: var(--space-1) 0 0; color: var(--fg-muted); overflow-wrap: anywhere; }
    .desc { color: var(--fg-1); }
    .pinned {
      margin-inline-start: var(--space-2); font-size: 0.8125rem; font-weight: 400;
      color: var(--fg-muted); white-space: nowrap;
    }
    .notice { color: var(--fg-muted); margin: var(--space-2) 0; }
    .failed { display: flex; align-items: center; gap: var(--space-2); }
    [role="alert"] { color: var(--danger); }
  `]

  @state() private feeds: SavedFeed[] | undefined = undefined
  @state() private error: string | null = null
  @state() private retrying = false

  private dispose: (() => void) | null = null
  private loadedFor: CaribouClient | null = null

  override connectedCallback() {
    super.connectedCallback()
    this.dispose = effect(() => {
      const client = activeClient.value
      this.feeds = client ? savedFeedsFor(client.userKey) : undefined
      if (client && client !== this.loadedFor) {
        this.loadedFor = client
        void this.load(client)
      }
    })
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.dispose = null
    this.loadedFor = null
    super.disconnectedCallback()
  }

  private async load(client: CaribouClient): Promise<void> {
    this.error = null
    try {
      await loadSavedFeeds({ clientSource: () => client })
    } catch (err) {
      if (this.loadedFor === client) this.error = (err as Error).message || 'Could not load your feeds.'
    }
  }

  private onRetry = async () => {
    const client = activeClient.peek()
    if (!client || this.retrying) return
    this.retrying = true
    try {
      await this.load(client)
    } finally {
      this.retrying = false
    }
  }

  private renderFeed(f: SavedFeed) {
    const avatar = f.avatar
      ? html`<img src=${f.avatar} alt="" loading="lazy" />`
      : html`<span class="no-avatar" aria-hidden="true"></span>`
    const pinned = f.pinned ? html`<span class="pinned">Pinned</span>` : nothing
    const name = f.available
      ? html`<a class="name" href=${feedPath(f.uri)} @click=${spaClick}>${f.name}</a>`
      : html`<span class="name">${f.name}</span>`
    return html`<li data-feed=${f.uri}>
      ${avatar}
      <div class="text">
        <div>${name}${pinned}</div>
        ${f.creator ? html`<p class="by">by @${f.creator}</p>` : nothing}
        ${!f.available ? html`<p class="gone">Not available</p>`
          : f.description ? html`<p class="desc">${f.description}</p>` : nothing}
      </div>
    </li>`
  }

  private renderBody() {
    if (this.error) {
      return html`<div class="failed"><div role="alert">${this.retrying ? '' : this.error}</div>
        <caribou-button variant="secondary" ?loading=${this.retrying} @click=${this.onRetry}>Retry</caribou-button></div>`
    }
    const feeds = this.feeds
    if (!feeds) return html`<p class="notice">Loading your feeds…</p>`
    // Following is always there: it is Home.
    const all: SavedFeed[] = feeds.some((f) => f.kind === 'timeline') ? feeds : [
      { id: 'following', kind: 'timeline', uri: '', pinned: true, name: 'Following', description: '', avatar: null, creator: null, available: true },
      ...feeds,
    ]
    return html`<ul>${repeat(all, (f) => f.id, (f) => this.renderFeed(f))}</ul>
      ${feeds.every((f) => f.kind !== 'feed')
        ? html`<p class="notice">No saved feeds yet. Save feeds in the Bluesky app to see them here.</p>`
        : nothing}`
  }

  override render() {
    return html`<div><h1>Feeds</h1>${this.renderBody()}</div>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-feeds': CaribouFeeds }
}
