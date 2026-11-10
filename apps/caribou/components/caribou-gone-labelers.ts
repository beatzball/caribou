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
 * them. The busy and failed state belong to one account. The live region is
 * always there, so the server and the first client render are the same
 * empty region.
 */
@customElement('caribou-gone-labelers')
export class CaribouGoneLabelers extends LitElement {
  static override styles = css`
    :host { display: block; }
    .notice {
      box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3);
      max-width: 640px; padding: var(--space-3); margin: var(--space-3) auto 0;
      background: var(--bg-2); color: var(--fg-0); border-radius: var(--radius-md);
    }
    p { margin: 0; flex: 1 1 16rem; overflow-wrap: anywhere; }
    code { font-size: 0.875em; }
    .error { color: var(--danger); flex-basis: 100%; }
    .announce {
      position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
      overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
    }
  `

  @state() private dids: readonly string[] = []
  // The account the busy and failed state belong to.
  @state() private owner: string | null = null
  // The DIDs with a removal (or its confirm) in progress, and the failed ones.
  @state() private busy: ReadonlySet<string> = new Set()
  @state() private failed: ReadonlySet<string> = new Set()
  @state() private announce = ''
  // Moves on every owner change: an action is current only with its token.
  private token = 0
  private stop?: () => void

  protected override firstUpdated() {
    this.stop = effect(() => {
      const key = activeUserKey.value
      const gone = blueskyGoneLabelers.value
      this.dids = gone && gone.userKey === key ? gone.dids : []
      if (key !== this.owner) {
        this.owner = key
        this.token++
        this.busy = new Set()
        this.failed = new Set()
        this.announce = ''
      }
    })
  }

  override disconnectedCallback() {
    this.stop?.()
    this.stop = undefined
    super.disconnectedCallback()
  }

  private async removeLabeler(did: string) {
    if (this.busy.has(did)) return
    const token = this.token
    const mine = () => this.token === token
    const index = this.dids.indexOf(did)
    // Cleared, so the result is always a change and is announced.
    this.announce = ''
    this.busy = new Set([...this.busy, did])
    this.failed = new Set([...this.failed].filter((d) => d !== did))
    let outcome: Awaited<ReturnType<typeof removeActiveGoneLabeler>> | null = null
    try {
      const ok = await confirmDialog({
        title: 'Remove labeler?',
        message: `The labeler ${did} is gone. Remove it from your Bluesky moderation settings?`,
        confirmLabel: 'Remove',
      })
      if (ok) outcome = await removeActiveGoneLabeler(did)
    } catch {
      if (mine()) this.failed = new Set([...this.failed, did])
    }
    if (!mine()) return
    this.busy = new Set([...this.busy].filter((d) => d !== did))
    if (outcome === 'removed' || outcome === 'absent') this.announce = 'Labeler removed.'
    else if (outcome === 'back') this.announce = 'The labeler is back. Nothing was removed.'
    else return
    await this.updateComplete
    if (this.dids.includes(did)) return
    this.focusAfter(index)
  }

  // The next Remove button, else the last one, else `main`.
  private focusAfter(index: number) {
    const buttons = [...this.renderRoot.querySelectorAll<HTMLElement>('.notice caribou-button')]
    const next = buttons[Math.min(index, buttons.length - 1)]
    if (next) return next.focus()
    const root = this.getRootNode() as Document | ShadowRoot
    const main = root.querySelector<HTMLElement>('main')
    if (!main) return
    // Focusable only for this move: the tabindex goes when focus leaves.
    if (!main.hasAttribute('tabindex')) {
      main.setAttribute('tabindex', '-1')
      main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true })
    }
    main.focus({ preventScroll: true })
  }

  override render() {
    return html`<div class="notices">${this.dids.map((did) => html`
        <div class="notice" role="status">
          <p>A labeler in your Bluesky moderation settings is gone: <code>${did}</code>. Bluesky posts stay covered until you remove it.</p>
          <caribou-button variant="secondary" label=${`Remove labeler ${did}`} ?loading=${this.busy.has(did)}
            @click=${() => this.removeLabeler(did)}>Remove</caribou-button>
          ${this.failed.has(did) ? html`<p class="error">Could not remove the labeler. Try again.</p>` : nothing}
        </div>
      `)}</div><p class="announce" role="status">${this.announce}</p>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'caribou-gone-labelers': CaribouGoneLabelers
  }
}
