import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { effect } from '@preact/signals-core'
import type { UserKey } from '@beatzball/caribou-auth'
import type { Status } from '@beatzball/caribou-mastodon-client'
import {
  actAs, actAsAccounts, activeUserKey, readAsAccount, userName,
  type ActAsResult, type ActAsView, type StatusAction, type UserSession,
} from '@beatzball/caribou-state'
import { boxReset } from './_shared-styles.js'
import './caribou-button.js'
import './caribou-icon-button.js'

// README, "Act as another account (#197)". The numbers in the comments
// below name its rules.

type Loaded =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; view: ActAsView }
  | { status: 'expired' }
  | { status: 'error'; message: string }

interface ActionSpec { icon: string; on: string; off: string; done: [string, string] }

const ACTIONS: [StatusAction, ActionSpec][] = [
  ['reblog', { icon: 'repeat2', on: 'Boost', off: 'Undo boost', done: ['Boosted', 'Boost undone'] }],
  ['favourite', { icon: 'star', on: 'Favourite', off: 'Unfavourite', done: ['Favourited', 'Unfavourited'] }],
  ['bookmark', { icon: 'bookmark', on: 'Bookmark', off: 'Remove bookmark', done: ['Bookmarked', 'Bookmark removed'] }],
]

const FLAG: Record<StatusAction, 'favourited' | 'reblogged' | 'bookmarked'> = {
  favourite: 'favourited', reblog: 'reblogged', bookmark: 'bookmarked',
}

const SIGNED_OUT = 'Signed out. Sign in again to use it.'

// "Act as another account" for one post: pick an account, see its own
// Favourite, Boost and Bookmark, and toggle them. A native `<dialog>`:
// focus stays inside, Escape closes it, and focus goes back to what opened
// it. The card itself never changes (rule 4).
@customElement('caribou-act-as-dialog')
export class CaribouActAsDialog extends LitElement {
  static override styles = [boxReset, css`
    dialog {
      inline-size: min(28rem, calc(100vw - 2 * var(--space-4)));
      max-block-size: min(32rem, calc(100dvh - 2 * var(--space-4)));
      padding: var(--space-4); color: var(--fg-0); background: var(--bg-0);
      border: 1px solid var(--border); border-radius: var(--radius-md);
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.25);
    }
    dialog::backdrop { background: rgb(0 0 0 / 0.5); }
    h2 { margin: 0 0 var(--space-3); font-size: 1.125rem; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { padding-block: var(--space-1); }
    .account { display: flex; flex-direction: column; gap: var(--space-1); }
    .account > caribou-button { align-self: stretch; }
    .handle { overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .notice { color: var(--fg-muted); margin: var(--space-2) 0; }
    [role="alert"] { color: var(--danger); margin: var(--space-2) 0; }
    [role="status"] { margin: var(--space-2) 0; min-block-size: 1.25em; }
    .buttons { display: flex; justify-content: flex-end; margin-top: var(--space-4); }
  `]

  @property({ attribute: false }) status: Status | null = null

  @state() private accounts: UserSession[] = []
  @state() private picked: UserKey | null = null
  @state() private loaded: Loaded = { status: 'idle' }
  @state() private busy = new Set<StatusAction>()
  @state() private said = ''
  @state() private failure = ''

  private dispose: (() => void) | null = null
  private resolve: (() => void) | null = null
  private cancelled = false
  // Each pick gets a new number; an answer for an older pick is dropped.
  private pick = 0

  override connectedCallback() {
    super.connectedCallback()
    this.dispose = effect(() => {
      const status = this.status
      this.accounts = status ? actAsAccounts(status) : []
      // An account that expired while picked says so (rule 5).
      const picked = this.accounts.find((u) => u.userKey === this.picked)
      if (picked?.expired && this.loaded.status !== 'expired') this.loaded = { status: 'expired' }
    })
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.dispose = null
    super.disconnectedCallback()
  }

  /** Opens the dialog. Resolves when it closes. */
  async show(): Promise<void> {
    await this.updateComplete
    if (this.cancelled) return
    const dialog = this.renderRoot.querySelector('dialog')!
    return new Promise((resolve) => {
      this.resolve = resolve
      dialog.showModal()
      // One account: it is picked at once.
      const only = this.accounts.length === 1 ? this.accounts[0]! : null
      if (only) this.onPick(only)
      else this.renderRoot.querySelector<HTMLElement>('ul caribou-button')?.focus()
    })
  }

  private finish() {
    this.cancelled = true
    const resolve = this.resolve
    this.resolve = null
    this.renderRoot.querySelector('dialog')?.close()
    resolve?.()
  }

  /** Closes the dialog, even before it opened. */
  cancel() {
    this.finish()
  }

  private onPick = async (account: UserSession) => {
    const status = this.status
    if (!status || this.cancelled) return
    const n = ++this.pick
    this.picked = account.userKey
    this.said = ''
    this.failure = ''
    this.busy = new Set()
    if (account.expired) {
      this.loaded = { status: 'expired' }
      return
    }
    this.loaded = { status: 'loading' }
    const out = await readAsAccount(account.userKey, status)
    if (n !== this.pick || this.cancelled) return
    this.loaded = this.loadedFrom(out, { status: 'loading' })
  }

  private loadedFrom(out: ActAsResult, before: Loaded): Loaded {
    if (out.kind === 'ok') return { status: 'ready', view: out.view }
    if (out.kind === 'expired') return { status: 'expired' }
    if (out.kind === 'failed' && before.status !== 'ready') return { status: 'error', message: out.message }
    return before
  }

  private onAction = async (action: StatusAction, spec: ActionSpec) => {
    const status = this.status
    const loaded = this.loaded
    const userKey = this.picked
    if (!status || !userKey || loaded.status !== 'ready' || this.busy.has(action) || this.cancelled) return
    const n = this.pick
    const wasOn = loaded.view[FLAG[action]]
    this.busy = new Set(this.busy).add(action)
    this.said = ''
    this.failure = ''
    const out = await actAs(userKey, action, status, loaded.view)
    if (n !== this.pick || this.cancelled) return
    const busy = new Set(this.busy)
    busy.delete(action)
    this.busy = busy
    if (out.kind === 'busy') return
    if (out.kind === 'failed') {
      this.failure = out.message
      return
    }
    if (out.kind === 'expired') {
      this.loaded = { status: 'expired' }
      return
    }
    // Only this action's flag and record come from the answer; another
    // action's answer may have landed while this one was out.
    const now = this.loaded.status === 'ready' ? this.loaded.view : loaded.view
    const view: ActAsView = { ...now, [FLAG[action]]: out.view[FLAG[action]] }
    if (action === 'favourite') view.likeUri = out.view.likeUri
    if (action === 'reblog') view.repostUri = out.view.repostUri
    this.loaded = { status: 'ready', view }
    const account = this.accounts.find((u) => u.userKey === userKey)
    this.said = `${spec.done[wasOn ? 1 : 0]} as @${account ? userName(account) : ''}.`
  }

  private renderAccount(u: UserSession) {
    const name = userName(u)
    const picked = this.picked === u.userKey
    return html`<li class="account" data-user-key=${u.userKey}>
      <caribou-button variant=${picked ? 'primary' : 'secondary'} pressed=${picked ? 'true' : 'false'}
        label=${u.expired ? `@${name}. ${SIGNED_OUT}` : `Act as @${name}`}
        @click=${() => { void this.onPick(u) }}><span class="handle">@${name}</span></caribou-button>
      ${u.expired ? html`<span class="notice">${SIGNED_OUT}</span>` : nothing}
    </li>`
  }

  private renderPicked() {
    const account = this.accounts.find((u) => u.userKey === this.picked)
    if (!account) return nothing
    const name = userName(account)
    const loaded = this.loaded
    if (loaded.status === 'loading') return html`<p class="notice">Loading the post as @${name}…</p>`
    if (loaded.status === 'expired') return html`<p role="alert">@${name} is signed out. Sign in again to use it.</p>`
    if (loaded.status === 'error') return html`<p role="alert">${loaded.message}</p>`
    if (loaded.status !== 'ready') return nothing
    return html`<div class="actions" role="group" aria-label=${`Actions as @${name}`}>
      ${ACTIONS.map(([action, spec]) => {
        const on = loaded.view[FLAG[action]]
        return html`<caribou-icon-button class=${action} variant="ghost" icon=${spec.icon}
          label=${`${on ? spec.off : spec.on} as @${name}`}
          pressed=${on ? 'true' : 'false'}
          ?soft-disabled=${this.busy.has(action)}
          @click=${() => { void this.onAction(action, spec) }}></caribou-icon-button>`
      })}
    </div>`
  }

  override render() {
    return html`<dialog aria-labelledby="h" @close=${() => this.finish()}>
      <h2 id="h">Act as another account</h2>
      ${this.accounts.length === 0 ? html`<p class="notice">No other Bluesky account is signed in.</p>`
        : html`<ul>${repeat(this.accounts, (u) => u.userKey, (u) => this.renderAccount(u))}</ul>`}
      ${this.renderPicked()}
      ${this.failure ? html`<p role="alert">${this.failure}</p>` : nothing}
      <p role="status">${this.said}</p>
      <div class="buttons">
        <caribou-button class="done" variant="primary" @click=${() => this.finish()}>Done</caribou-button>
      </div>
    </dialog>`
  }
}

/**
 * Opens "Act as another account" for the post. Resolves when it closes;
 * it closes when the active account changes (rule 6). Client only.
 */
export async function openActAs(status: Status): Promise<void> {
  const el = document.createElement('caribou-act-as-dialog') as CaribouActAsDialog
  el.status = status
  document.body.appendChild(el)
  const owner = activeUserKey.peek()
  const stop = effect(() => { if (activeUserKey.value !== owner) el.cancel() })
  try {
    await el.show()
  } finally {
    stop()
    el.remove()
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-act-as-dialog': CaribouActAsDialog }
}
