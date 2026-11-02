import { LitElement, html, css, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { effect, signal } from '@preact/signals-core'
import { activeClient, activeUserKey, loadTag, tagCache, tagKey, toggleTagFollow } from '@beatzball/caribou-state'
import './caribou-button.js'

// The top of a hashtag page: the tag, and a Follow button for a signed-in
// reader. The button follows the tag on the reader's own server.
@customElement('caribou-tag-header')
export class CaribouTagHeader extends LitElement {
  static override styles = css`
    :host { display: block; border-bottom: 1px solid var(--border); }
    header { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4); }
    h1 { margin: 0; color: var(--fg-0); font-size: 1.25rem; overflow-wrap: anywhere; }
    .actions { margin-left: auto; }
    caribou-button.follow { min-width: 7.5rem; font-weight: 600; }
    /* "Following" reads as "Unfollow" under the pointer or keyboard focus,
       as on a profile (caribou-profile-header.ts). */
    caribou-button.follow .hover { display: none; }
    caribou-button.follow[data-state="following"]:is(:hover, [data-focus-visible]) .idle { display: none; }
    caribou-button.follow[data-state="following"]:is(:hover, [data-focus-visible]) .hover { display: inline; }
  `

  @property() name = ''

  // Whether the reader follows the tag, known only after mount: the server
  // has no session. Undefined until then, so the first client render equals
  // the server's, which shows no button.
  @state() private following: boolean | undefined = undefined

  private dispose: (() => void) | null = null
  // `name` as a signal too, so the effects below see a new name.
  private nameSignal = signal('')

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has('name')) this.nameSignal.value = this.name
  }

  override connectedCallback() {
    super.connectedCallback()
    // Re-attach after a move in the DOM; the first attach is in firstUpdated.
    if (this.hasUpdated && !this.dispose) this.bind()
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.dispose = null
    super.disconnectedCallback()
  }

  protected override firstUpdated() {
    this.bind()
  }

  private bind() {
    // A new session asks its own server again.
    const disposeLoad = effect(() => {
      const name = this.nameSignal.value
      if (activeClient.value && name) void loadTag(name)
    })
    const disposeRead = effect(() => {
      const userKey = activeUserKey.value
      const name = this.nameSignal.value
      this.following = userKey ? tagCache.value.get(tagKey(userKey, name)) : undefined
    })
    this.dispose = () => { disposeLoad(); disposeRead() }
  }

  private onFollowClick = () => { void toggleTagFollow(this.name) }

  // See the same handler in caribou-profile-header.ts.
  private onFollowFocus = (e: Event) => {
    const host = e.currentTarget as HTMLElement
    const inner = e.composedPath()[0] as Element
    host.toggleAttribute('data-focus-visible', e.type !== 'focusout' && inner.matches(':focus-visible'))
  }

  private renderFollow() {
    if (this.following === undefined) return nothing
    const state = this.following ? 'following' : 'follow'
    const label = this.following
      ? html`<span class="idle">Following</span><span class="hover">Unfollow</span>`
      : 'Follow'
    // A live region, so a screen reader hears the new label after a click.
    return html`<div class="actions" aria-live="polite">
      <caribou-button class="follow" data-state=${state} variant=${this.following ? 'secondary' : 'primary'}
        @click=${this.onFollowClick} @focusin=${this.onFollowFocus} @focusout=${this.onFollowFocus}
        @keydown=${this.onFollowFocus} @keyup=${this.onFollowFocus}
        >${label}</caribou-button>
    </div>`
  }

  override render() {
    return html`<header><h1>#${this.name}</h1>${this.renderFollow()}</header>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-tag-header': CaribouTagHeader }
}
