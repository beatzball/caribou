import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import { activeUserKey } from '@beatzball/caribou-state'
import { blueskyGoneLabelers } from './_bluesky-moderation.js'
import { removeActiveGoneLabeler } from './_bluesky-session.js'
import { confirmDialog } from './caribou-confirm-dialog.js'
import './caribou-button.js'

/**
 * A labeler in the active reader's Bluesky prefs is gone (#238; app README,
 * "A gone labeler"). One notice per gone labeler, named by its DID, with a
 * Remove that asks first. The covers stay until the new reader settles
 * them. The server and the first client render show nothing.
 */
@customElement('caribou-gone-labelers')
export class CaribouGoneLabelers extends LitElement {
  static override styles = css`
    :host { display: block; }
    [role="status"] {
      box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3);
      max-width: 640px; padding: var(--space-3); margin: var(--space-3) auto 0;
      background: var(--bg-2); color: var(--fg-0); border-radius: var(--radius-md);
    }
    p { margin: 0; flex: 1 1 16rem; overflow-wrap: anywhere; }
    code { font-size: 0.875em; }
    .error { color: var(--danger); flex-basis: 100%; }
  `

  @state() private dids: readonly string[] = []
  // The DIDs with a removal (or its confirm) in progress, and the failed ones.
  @state() private busy: ReadonlySet<string> = new Set()
  @state() private failed: ReadonlySet<string> = new Set()
  private stop?: () => void

  protected override firstUpdated() {
    this.stop = effect(() => {
      const gone = blueskyGoneLabelers.value
      this.dids = gone && gone.userKey === activeUserKey.value ? gone.dids : []
    })
  }

  override disconnectedCallback() {
    this.stop?.()
    this.stop = undefined
    super.disconnectedCallback()
  }

  private async removeLabeler(did: string) {
    if (this.busy.has(did)) return
    this.busy = new Set([...this.busy, did])
    this.failed = new Set([...this.failed].filter((d) => d !== did))
    try {
      const ok = await confirmDialog({
        title: 'Remove labeler?',
        message: `The labeler ${did} is gone. Remove it from your Bluesky moderation settings?`,
        confirmLabel: 'Remove',
      })
      if (ok) await removeActiveGoneLabeler(did)
    } catch {
      this.failed = new Set([...this.failed, did])
    } finally {
      this.busy = new Set([...this.busy].filter((d) => d !== did))
    }
  }

  override render() {
    if (this.dids.length === 0) return nothing
    return this.dids.map((did) => html`
      <div role="status">
        <p>A labeler in your Bluesky moderation settings is gone: <code>${did}</code>. Bluesky posts stay covered until you remove it.</p>
        <caribou-button variant="secondary" ?loading=${this.busy.has(did)} @click=${() => this.removeLabeler(did)}>Remove</caribou-button>
        ${this.failed.has(did) ? html`<p class="error" role="alert">Could not remove the labeler. Try again.</p>` : nothing}
      </div>
    `)
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'caribou-gone-labelers': CaribouGoneLabelers
  }
}
