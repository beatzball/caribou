import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import type { BlueskyGates, BlueskyReplyRule, CaribouClient, List } from '@beatzball/caribou-mastodon-client'
import {
  BLUESKY_DEFAULT_GATES, blueskyGatesText, listsCache, loadLists,
  setBlueskyQuotes, setBlueskyReplies, toggleBlueskyReplyRule,
} from '@beatzball/caribou-state'
import { boxReset } from './_shared-styles.js'

type Loaded = 'idle' | 'loading' | 'error' | 'ready'

const RULES: { kind: 'mention' | 'following' | 'follower'; label: string }[] = [
  { kind: 'mention', label: 'People you mention' },
  { kind: 'following', label: 'People you follow' },
  { kind: 'follower', label: 'Your followers' },
]

/**
 * Who can reply to a new Bluesky post, and whether it can be quoted (#199).
 * The button's text is the limit in plain words; it opens the panel. Each
 * change is a `gates-change` event with the new `BlueskyGates`: the dialog
 * keeps it in the draft. Rules: `packages/state` README, "Reply and quote
 * limits"; the app README, "Bluesky compose".
 */
@customElement('caribou-bluesky-gates')
export class CaribouBlueskyGates extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; }
    .toggle {
      display: inline-flex; align-items: center; gap: var(--space-1);
      min-block-size: 2.25rem; padding: 0 var(--space-2); font: inherit; font-size: 0.875rem;
      color: var(--accent); background: none; border: 1px solid var(--border); border-radius: var(--radius-md);
      cursor: pointer; text-align: start;
    }
    .toggle:disabled { color: var(--fg-muted); cursor: default; }
    .toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    fieldset {
      margin: var(--space-2) 0 0; padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border); border-radius: var(--radius-md);
      display: flex; flex-direction: column; gap: var(--space-1);
    }
    legend { padding: 0 var(--space-1); font-weight: 600; }
    .group { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); }
    label { display: inline-flex; gap: var(--space-2); align-items: center; min-block-size: 2.25rem; }
    input { margin: 0; accent-color: var(--accent); }
    select { font: inherit; min-block-size: 2.25rem; max-inline-size: 100%; }
    .note { margin: 0; color: var(--fg-muted); font-size: 0.875rem; }
    .problem { color: var(--danger); }
    @media (pointer: coarse) {
      .toggle, label, select { min-block-size: 44px; }
    }
  `]

  /** The draft's choice; absent is the default. */
  @property({ attribute: false }) gates: BlueskyGates | undefined = undefined
  /**
   * The dialog's client: the lists are this account's. A function, as the
   * client is not a value a template may hold.
   */
  @property({ attribute: false }) clientSource: () => CaribouClient | null = () => null
  /** True while a send runs: nothing can change. */
  @property({ type: Boolean }) disabled = false

  @state() private open = false
  @state() private loaded: Loaded = 'idle'
  @state() private lists: List[] | undefined = undefined

  private dispose: (() => void) | null = null

  override connectedCallback() {
    super.connectedCallback()
    this.dispose = effect(() => {
      const key = this.clientSource()?.userKey
      this.lists = key ? listsCache.value.get(key) : undefined
    })
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.dispose = null
    super.disconnectedCallback()
  }

  // The account the lists were read for; another account's are not this one's.
  private listsFor: string | null = null

  override willUpdate() {
    const key = this.clientSource()?.userKey ?? null
    if (key !== this.listsFor) {
      this.listsFor = key
      this.loaded = 'idle'
      this.lists = key ? listsCache.peek().get(key) : undefined
    }
  }

  private get value(): BlueskyGates {
    return this.gates ?? BLUESKY_DEFAULT_GATES
  }

  private emit(gates: BlueskyGates) {
    this.dispatchEvent(new CustomEvent<BlueskyGates>('gates-change', { detail: gates, bubbles: true, composed: true }))
  }

  private async loadLists() {
    const client = this.clientSource()
    if (!client || this.loaded === 'loading' || this.loaded === 'ready') return
    this.loaded = 'loading'
    try {
      await loadLists({ clientSource: () => client })
      if (client === this.clientSource()) this.loaded = 'ready'
    } catch {
      if (client === this.clientSource()) this.loaded = 'error'
    }
  }

  private onToggle = () => {
    this.open = !this.open
    if (this.open) void this.loadLists()
  }

  private onList = (e: Event) => {
    const id = (e.target as HTMLSelectElement).value
    const g = this.value
    const now = g.replies?.find((r) => r.kind === 'list')
    if (!id) {
      if (now) this.emit(toggleBlueskyReplyRule(g, now))
      return
    }
    const list = this.lists?.find((l) => l.id === id)
    this.emit(toggleBlueskyReplyRule(g, { kind: 'list', id, ...(list ? { title: list.title } : {}) }))
  }

  private renderLists(chosen: Extract<BlueskyReplyRule, { kind: 'list' }> | undefined) {
    const busy = this.disabled
    if (this.loaded === 'error') {
      return html`<p class="note problem" data-gates-lists-error role="status">Could not load your lists.</p>`
    }
    const lists = this.lists ?? []
    if (this.loaded !== 'ready' && lists.length === 0) {
      return chosen ? html`<p class="note" data-gates-list>People on ${chosen.title ?? 'your list'}</p>`
        : html`<p class="note">Loading your lists…</p>`
    }
    if (lists.length === 0 && !chosen) return html`<p class="note" data-gates-no-lists>You have no lists.</p>`
    // A chosen list missing from the loaded ones (deleted since) stays
    // shown, so the select never says something the draft does not hold.
    const shown = chosen && !lists.some((l) => l.id === chosen.id)
      ? [...lists, { id: chosen.id, title: chosen.title ?? 'your list' } as List] : lists
    return html`<label>People on
      <select data-gates-list-select ?disabled=${busy} @change=${this.onList}>
        <option value="" ?selected=${!chosen}>no list</option>
        ${shown.map((l) => html`<option value=${l.id} ?selected=${chosen?.id === l.id}>${l.title}</option>`)}
      </select></label>`
  }

  override render() {
    const g = this.value
    const text = blueskyGatesText(g)
    const busy = this.disabled
    const replies = g.replies
    const chosenList = replies?.find((r): r is Extract<BlueskyReplyRule, { kind: 'list' }> => r.kind === 'list')
    // One wrapper: happy-dom (the unit tests' DOM) drops a binding at a
    // template's top level.
    return html`<div class="gates">
      <button type="button" class="toggle" data-action="gates" aria-expanded=${this.open ? 'true' : 'false'}
        aria-controls="gates-panel" @click=${this.onToggle}>
        <span data-gates-text>${text}</span>
      </button>
      ${this.open ? html`
      <fieldset id="gates-panel" data-gates-panel ?disabled=${busy}>
        <legend>Who can reply</legend>
        <div class="group">
          <label><input type="radio" name="gates-who" data-gates="everyone" .checked=${replies === null}
            @change=${() => this.emit(setBlueskyReplies(g, 'everyone'))}>Everyone</label>
          <label><input type="radio" name="gates-who" data-gates="nobody" .checked=${replies !== null && replies.length === 0}
            @change=${() => this.emit(setBlueskyReplies(g, 'nobody'))}>Nobody</label>
        </div>
        <p class="note">Or only:</p>
        <div class="group">
          ${RULES.map((r) => html`<label><input type="checkbox" data-gates=${r.kind}
            .checked=${!!replies?.some((x) => x.kind === r.kind)}
            @change=${() => this.emit(toggleBlueskyReplyRule(g, { kind: r.kind }))}>${r.label}</label>`)}
          ${this.renderLists(chosenList)}
        </div>
        <label><input type="checkbox" data-gates="quotes" .checked=${g.quotes}
          @change=${(e: Event) => this.emit(setBlueskyQuotes(g, (e.target as HTMLInputElement).checked))}>Allow quotes</label>
      </fieldset>` : nothing}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-bluesky-gates': CaribouBlueskyGates }
}
