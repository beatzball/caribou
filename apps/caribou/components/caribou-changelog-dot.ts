import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import { changelogUnread } from './_changelog-seen.js'

/**
 * A small dot that says a newer version shipped than the reader has seen on
 * `/changelog`. Put it inside a `position: relative` box (a nav item's icon
 * wrapper); it sits on that box's top-right corner and takes no room, so
 * showing it moves nothing. The dot is hidden from assistive tech.
 *
 * With `text`, it draws no dot and says ", new version" to a screen reader
 * instead. Put that one after the item's label, so a link reads
 * "Changelog, new version":
 *
 *   <span class="icon-wrap"><caribou-icon …></caribou-icon><caribou-changelog-dot></caribou-changelog-dot></span>
 *   <span class="label">Changelog</span><caribou-changelog-dot text></caribou-changelog-dot>
 *
 * The marker is in localStorage, which the server does not have, so the
 * server and the first client render show nothing; the dot comes after the
 * first update.
 */
@customElement('caribou-changelog-dot')
export class CaribouChangelogDot extends LitElement {
  static override styles = css`
    :host {
      position: absolute; top: -2px; right: -3px;
      width: 8px; height: 8px; pointer-events: none;
    }
    :host([text]) { position: static; display: inline; width: auto; height: auto; }
    .dot {
      display: block; width: 100%; height: 100%; border-radius: 50%;
      background: var(--accent); box-shadow: 0 0 0 2px var(--bg-0);
    }
    .sr-only {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap;
    }
  `

  /** Say ", new version" to a screen reader instead of drawing the dot. */
  @property({ type: Boolean, reflect: true }) text = false

  @state() private unread = false

  private _unsubscribe?: () => void

  override connectedCallback() {
    super.connectedCallback()
    this._unsubscribe = effect(() => {
      const unread = changelogUnread.value
      if (this.hasUpdated) this.unread = unread
    })
  }

  override disconnectedCallback() {
    this._unsubscribe?.()
    this._unsubscribe = undefined
    super.disconnectedCallback()
  }

  protected override firstUpdated() {
    this.unread = changelogUnread.value
  }

  protected override updated() {
    this.toggleAttribute('unread', this.unread)
  }

  override render() {
    if (!this.unread) return nothing
    return this.text
      ? html`<span class="sr-only">, new version</span>`
      : html`<span class="dot" aria-hidden="true"></span>`
  }
}
