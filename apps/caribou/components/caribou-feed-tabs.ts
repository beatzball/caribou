import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import type { CaribouClient, SavedFeed } from '@beatzball/caribou-mastodon-client'
import { activeClient, loadSavedFeeds, savedFeedsFor } from '@beatzball/caribou-state'
import { FEED_GONE } from '@beatzball/caribou-bluesky-client'
import { spaClick } from './_spa-link.js'
import { feedPath, feedRkey, isFeedUri } from './_feed-path.js'
import { settleSplash } from './_splash.js'
import './caribou-tabs.js'
import './caribou-timeline.js'

interface Tab { uri: string; name: string }

// Bluesky Home (#194; README, "Bluesky feeds"): a row of tabs, Following
// first and then the reader's pinned feeds, over the timeline of the one
// the address names (`feed`, '' for Following). Client only: the page
// renders it after mount, with a Bluesky account active. Read only.
@customElement('caribou-feed-tabs')
export class CaribouFeedTabs extends LitElement {
  static override styles = css`
    :host { display: block; }
    .notice { padding: var(--space-4); color: var(--fg-muted); }
    .notice a { color: var(--accent); }
  `

  /** The feed's AT URI, or '' for Following. Set once: a tab is a new page. */
  @property({ reflect: true }) feed = ''

  @state() private saved: SavedFeed[] | undefined = undefined

  private dispose: (() => void) | null = null
  private loadedFor: CaribouClient | null = null

  override connectedCallback() {
    super.connectedCallback()
    this.dispose = effect(() => {
      const client = activeClient.value
      this.saved = client ? savedFeedsFor(client.userKey) : undefined
      if (client && client !== this.loadedFor) {
        this.loadedFor = client
        // A failed load leaves the row as Following alone; the Feeds page
        // shows the error, with Retry.
        loadSavedFeeds({ clientSource: () => client }).catch(() => {})
      }
    })
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.dispose = null
    this.loadedFor = null
    super.disconnectedCallback()
  }

  private get tabs(): Tab[] {
    const tabs: Tab[] = [{ uri: '', name: 'Following' }]
    for (const f of this.saved ?? []) {
      if (f.kind === 'feed' && f.pinned) tabs.push({ uri: f.uri, name: f.name })
    }
    if (this.feed && isFeedUri(this.feed) && !tabs.some((t) => t.uri === this.feed)) {
      const known = this.saved?.find((f) => f.uri === this.feed)
      tabs.push({ uri: this.feed, name: known?.name ?? feedRkey(this.feed) })
    }
    return tabs
  }

  protected override updated() {
    // A feed's tab shows no timeline when it is gone or not a feed; the
    // loading screen of a forward must still go.
    if (this.feed && !this.showsTimeline) settleSplash('/home')
  }

  private get showsTimeline(): boolean {
    if (!this.feed) return true
    if (!isFeedUri(this.feed)) return false
    return this.saved?.find((f) => f.uri === this.feed)?.available !== false
  }

  private renderBody() {
    if (!this.feed) return html`<caribou-timeline kind="home"></caribou-timeline>`
    if (!isFeedUri(this.feed)) {
      return html`<p class="notice" role="status">This address does not name a feed.
        <a href="/home" @click=${spaClick}>Go to Following</a>.</p>`
    }
    if (!this.showsTimeline) return html`<p class="notice" role="status">${FEED_GONE}</p>`
    return html`<caribou-timeline kind="feed" feed=${this.feed}></caribou-timeline>`
  }

  override render() {
    const tabs = this.tabs
    const current = this.feed
    return html`<div>
      ${tabs.length > 1 ? html`<caribou-tabs label="Feeds">
        ${tabs.map((t) => html`<a href=${feedPath(t.uri)} data-feed=${t.uri}
          aria-current=${t.uri === current ? 'page' : nothing} @click=${spaClick}>${t.name}</a>`)}
      </caribou-tabs>` : nothing}
      ${this.renderBody()}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-feed-tabs': CaribouFeedTabs }
}
