import { LitElement, html, css } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { effect } from '@preact/signals-core'
import { activeClient } from '@beatzball/caribou-state'
import { boxReset } from './_shared-styles.js'
import { rendersBluesky } from './_bluesky-route.js'
import './caribou-tag-header.js'
import './caribou-timeline.js'

/** The tag's page on bsky.app, for a reader with no Bluesky account active. */
export function bskyHashtagUrl(tag: string): string {
  return `https://bsky.app/hashtag/${encodeURIComponent(tag)}`
}

/**
 * The body of `/tags/<tag>?net=bsky` (app README, "Bluesky search and
 * hashtag page"). Post search needs a token, so the server sends no posts.
 * The server render and the first client render show the sign-in notice.
 * After mount, with a Bluesky account active, the tag's newest posts come
 * from that account's client; with any other account, or none, the notice
 * stays.
 */
@customElement('caribou-bluesky-tag')
export class CaribouBlueskyTag extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; }
    .notice { padding: var(--space-4); color: var(--fg-muted); margin: 0; }
    a, litro-link { color: var(--accent); text-decoration-line: underline; }
  `]

  @property() tag = ''

  // The active Bluesky account's key, read after the first update so the
  // first client render equals the server's. Null: no Bluesky account.
  @state() private reader: string | null = null
  private dispose: (() => void) | null = null

  override connectedCallback() {
    super.connectedCallback()
    if (this.hasUpdated && !this.dispose) this.bind()
  }

  protected override firstUpdated() {
    this.bind()
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.dispose = null
    super.disconnectedCallback()
  }

  private bind() {
    this.dispose = effect(() => {
      const client = activeClient.value
      this.reader = client && rendersBluesky(client) ? client.userKey : null
    })
  }

  override render() {
    // The heading stays the same element whichever body follows it.
    return html`<div><caribou-tag-header name=${this.tag}></caribou-tag-header>${this.renderBody()}</div>`
  }

  // Sign in goes to the add-account page: with an account active, `/`
  // forwards to Home (`_root-forward.ts`).
  private renderBody() {
    if (this.reader) {
      // A new account gets a new timeline: nothing from the last one stays.
      return repeat([this.reader], (k) => k, () => html`<caribou-timeline kind="hashtag" net="bsky" tag=${this.tag}></caribou-timeline>`)
    }
    return html`<p class="notice">
        Sign in with Bluesky to see posts with this tag.
        <litro-link href="/?add">Sign in</litro-link>
        or <a class="outside" href=${bskyHashtagUrl(this.tag)} rel="noopener noreferrer" target="_blank">See #${this.tag} on Bluesky</a>
      </p>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-bluesky-tag': CaribouBlueskyTag }
}
