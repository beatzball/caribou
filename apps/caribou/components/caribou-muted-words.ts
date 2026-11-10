import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { live } from 'lit/directives/live.js'
import { effect } from '@preact/signals-core'
import { activeUserKey } from '@beatzball/caribou-state'
import { blueskyReader } from './_bluesky-moderation.js'
import { editActiveMutedWords, reloadActiveModeration, type MutedWordEdit } from './_bluesky-session.js'
import { boxReset } from './_shared-styles.js'
import './caribou-button.js'

/** A muted word as the reader's prefs carry it. */
interface Word { id?: string; value: string; targets: string[]; actorTarget?: string; expiresAt?: string }

type Where = 'content' | 'tag'
type Who = 'all' | 'exclude-following'
type Duration = 'forever' | '24h' | '7d' | '30d'

const DURATIONS: { value: Duration; label: string; ms: number }[] = [
  { value: 'forever', label: 'Forever', ms: 0 },
  { value: '24h', label: '24 hours', ms: 24 * 3600_000 },
  { value: '7d', label: '7 days', ms: 7 * 24 * 3600_000 },
  { value: '30d', label: '30 days', ms: 30 * 24 * 3600_000 },
]

const ADD = 'add'
const keyOf = (w: Word) => (w.id ? `id:${w.id}` : `value:${w.value}`)

/**
 * The active Bluesky reader's muted words (#196; app README, "Bluesky
 * muted words"): the list from the reader's prefs, an add form, and Remove
 * on each row. The list changes only when the reader's prefs do, so it
 * never shows a write that did not happen. Client only: the moderation
 * settings page renders it after mount.
 */
@customElement('caribou-muted-words')
export class CaribouMutedWords extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { display: flex; align-items: center; gap: var(--space-3); border-bottom: 1px solid var(--border); padding: var(--space-3) 0; }
    .what { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow-wrap: anywhere; }
    .what strong { color: var(--fg-0); }
    .meta { color: var(--fg-muted); font-size: 0.875rem; }
    .notice, .intro { color: var(--fg-muted); margin: var(--space-2) 0; }
    [role="alert"] { color: var(--danger); margin: var(--space-2) 0; }
    form:not([hidden]) { display: flex; flex-direction: column; gap: var(--space-3); margin-top: var(--space-4); }
    label.field { display: flex; flex-direction: column; gap: var(--space-1); }
    input[type="text"], select {
      font: inherit; color: var(--fg-0); background: var(--bg-1); border: 1px solid var(--border);
      border-radius: var(--radius-md); padding: var(--space-2);
    }
    fieldset { border: 0; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-3); }
    legend { padding: 0; margin-bottom: var(--space-1); }
    input[type="radio"] { accent-color: var(--accent); }
    .announce {
      position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
      overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
    }
  `]

  // undefined: the reader has not loaded; null: its prefs failed to load.
  @state() private words: readonly Word[] | null | undefined = undefined
  @state() private busy: ReadonlySet<string> = new Set()
  @state() private error = ''
  @state() private formError = ''
  @state() private reloadFailed = false
  @state() private announce = ''
  @state() private value = ''
  @state() private where: Where = 'content'
  @state() private who: Who = 'all'
  @state() private duration: Duration = 'forever'

  private owner: string | null | undefined = undefined
  // Moves on every account change: an answer is shown only with its token.
  private token = 0
  private stop?: () => void

  override connectedCallback() {
    super.connectedCallback()
    this.stop = effect(() => {
      const key = activeUserKey.value
      const reader = blueskyReader.value
      this.words = reader && reader.userKey === key ? (reader.prefs ? reader.prefs.mutedWords as Word[] : null) : undefined
      if (key !== this.owner) {
        this.owner = key
        this.token++
        this.busy = new Set()
        this.error = ''
        this.formError = ''
        this.reloadFailed = false
        this.announce = ''
      }
    })
  }

  override disconnectedCallback() {
    this.stop?.()
    this.stop = undefined
    super.disconnectedCallback()
  }

  // One write per button at a time. The client's queue orders the rest.
  private async save(key: string, edit: MutedWordEdit, done: string, failed: string): Promise<boolean> {
    if (this.busy.has(key)) return false
    const token = this.token
    this.busy = new Set([...this.busy, key])
    this.error = ''
    this.reloadFailed = false
    // Cleared, so the next result is always a change and is announced.
    this.announce = ''
    let ok = false
    try {
      const r = await editActiveMutedWords(edit)
      if (token !== this.token || r.outcome === 'stale') return false
      ok = true
      if (r.reloadFailed) this.reloadFailed = true
      this.announce = r.outcome === 'exists' ? `You already mute “${edit.value}”.`
        : r.outcome === 'absent' ? `“${edit.value}” was not muted.`
        : done
    } catch (err) {
      if (token !== this.token) return false
      if ((err as { name?: string } | null)?.name === 'InvalidMutedWord') {
        this.formError = (err as Error).message
      } else {
        this.error = failed
        window.dispatchEvent(new CustomEvent('caribou:toast', { detail: { kind: 'error', message: failed } }))
      }
    } finally {
      if (token === this.token) this.busy = new Set([...this.busy].filter((k) => k !== key))
    }
    return ok
  }

  private async onSubmit(e: Event) {
    e.preventDefault()
    if (this.busy.has(ADD) || !Array.isArray(this.words)) return
    const value = this.value.trim()
    this.formError = ''
    if (!value) {
      this.formError = 'Enter a word to mute.'
      return
    }
    const ms = DURATIONS.find((d) => d.value === this.duration)?.ms ?? 0
    const edit: MutedWordEdit = {
      kind: 'add', value,
      targets: this.where === 'content' ? ['content', 'tag'] : ['tag'],
      actorTarget: this.who,
      ...(ms ? { expiresAt: new Date(Date.now() + ms).toISOString() } : {}),
    }
    const token = this.token
    const ok = await this.save(ADD, edit, `Muted “${value}”.`, `Could not mute “${value}”. Try again.`)
    if (ok && token === this.token) this.value = ''
  }

  private onRemove(w: Word) {
    const edit: MutedWordEdit = w.id ? { kind: 'remove', id: w.id, value: w.value } : { kind: 'remove', value: w.value }
    void this.save(keyOf(w), edit, `Unmuted “${w.value}”.`, `Could not remove “${w.value}”. Try again.`)
  }

  private onRetry() {
    this.reloadFailed = false
    void reloadActiveModeration()
  }

  private renderWord(w: Word) {
    const where = w.targets.includes('content') ? 'Text and tags' : 'Tags only'
    const who = w.actorTarget === 'exclude-following' ? 'People I do not follow' : 'Everyone'
    // Rendered in the browser only, so the clock is safe to read.
    const at = w.expiresAt ? Date.parse(w.expiresAt) : NaN
    const until = !w.expiresAt ? 'Forever'
      : Number.isFinite(at) && at <= Date.now() ? 'Expired'
      : `Until ${Number.isFinite(at) ? new Date(at).toLocaleString() : w.expiresAt}`
    return html`<li class="word">
      <span class="what"><strong>${w.value}</strong><span class="meta">${where} · ${who} · ${until}</span></span>
      <caribou-button variant="secondary" data-action="remove" label=${`Remove muted word ${w.value}`}
        ?loading=${this.busy.has(keyOf(w))} @click=${() => this.onRemove(w)}>Remove</caribou-button>
    </li>`
  }

  private renderList() {
    const words = this.words
    if (words === undefined) return html`<p class="notice">Loading muted words…</p>`
    if (words === null) {
      return html`<div role="alert">Could not load your muted words.
        <caribou-button variant="secondary" data-action="retry" @click=${() => this.onRetry()}>Retry</caribou-button></div>`
    }
    if (words.length === 0) return html`<p class="notice">You have not muted any words.</p>`
    return html`<ul>${repeat(words, keyOf, (w) => this.renderWord(w))}</ul>`
  }

  // Always in the tree, hidden until the list is loaded: an add needs the
  // reader.
  private renderForm(hidden: boolean) {
    return html`<form @submit=${this.onSubmit} novalidate ?hidden=${hidden}>
      <label class="field">Word or phrase
        <input type="text" name="value" maxlength="1000" autocomplete="off" .value=${live(this.value)}
          @input=${(e: Event) => { this.value = (e.target as HTMLInputElement).value; this.formError = '' }} />
      </label>
      <fieldset>
        <legend>Mute in</legend>
        <label><input type="radio" name="targets" value="content" .checked=${live(this.where === 'content')}
          @change=${() => { this.where = 'content' }} /> Text and tags</label>
        <label><input type="radio" name="targets" value="tag" .checked=${live(this.where === 'tag')}
          @change=${() => { this.where = 'tag' }} /> Tags only</label>
      </fieldset>
      <fieldset>
        <legend>Mute posts from</legend>
        <label><input type="radio" name="actor" value="all" .checked=${live(this.who === 'all')}
          @change=${() => { this.who = 'all' }} /> Everyone</label>
        <label><input type="radio" name="actor" value="exclude-following" .checked=${live(this.who === 'exclude-following')}
          @change=${() => { this.who = 'exclude-following' }} /> People I do not follow</label>
      </fieldset>
      <label class="field">For how long
        <select name="duration" @change=${(e: Event) => { this.duration = (e.target as HTMLSelectElement).value as Duration }}>
          ${DURATIONS.map((d) => html`<option value=${d.value} ?selected=${this.duration === d.value}>${d.label}</option>`)}
        </select>
      </label>
      ${this.formError ? html`<p role="alert">${this.formError}</p>` : nothing}
      <div><caribou-button variant="primary" type="submit" data-action="add" ?loading=${this.busy.has(ADD)}>Mute</caribou-button></div>
    </form>`
  }

  override render() {
    return html`<div>
      <p class="intro">Posts with these words are hidden. A word stays in this list after it expires.</p>
      ${this.renderList()}
      ${this.error ? html`<p role="alert">${this.error}</p>` : nothing}
      ${this.reloadFailed ? html`<div role="alert">Saved, but your settings did not load again.
        <caribou-button variant="secondary" data-action="retry" @click=${() => this.onRetry()}>Retry</caribou-button></div>` : nothing}
      ${this.renderForm(!Array.isArray(this.words))}
      <p class="announce" role="status">${this.announce}</p>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-muted-words': CaribouMutedWords }
}
