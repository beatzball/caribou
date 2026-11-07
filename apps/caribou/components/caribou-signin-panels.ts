import { LitElement, html, css } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { boxReset } from './_shared-styles.js'
import './caribou-instance-picker.js'
import './caribou-bluesky-signin.js'

export type SigninNetwork = 'mastodon' | 'bluesky'

const TABS: readonly { id: SigninNetwork; label: string }[] = [
  { id: 'mastodon', label: 'Mastodon' },
  { id: 'bluesky', label: 'Bluesky' },
]

/**
 * Two sign-in panels, Mastodon and Bluesky (spec 5.5, step 1). A real
 * tablist, not the link-based `caribou-tabs`, which navigates. Keyboard as
 * the ARIA tabs pattern, with automatic activation: Left and Right move to
 * the previous and next tab and wrap, Home and End go to the first and last.
 * Only the selected tab is in the tab order (roving tabindex); Tab from it
 * goes to the panel's first field (a panel holds a form, so it is not a
 * tab stop itself).
 */
@customElement('caribou-signin-panels')
export class CaribouSigninPanels extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; }
    [role="tablist"] {
      display: flex; gap: var(--space-2); max-width: 400px; margin: 0 auto var(--space-4);
      border-bottom: 1px solid var(--border);
    }
    [role="tab"] {
      flex: 1; min-height: 44px; padding: 0 var(--space-3);
      background: none; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px;
      color: var(--fg-1); font: inherit; cursor: pointer;
    }
    [role="tab"][aria-selected="true"] { color: var(--fg-0); border-bottom-color: var(--accent); font-weight: 600; }
    [role="tab"]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    [hidden] { display: none; }
  `]

  /** `/?add`: passed on to the Mastodon form. */
  @property({ type: Boolean }) add = false

  @state() selected: SigninNetwork = 'mastodon'

  private select(id: SigninNetwork, focus: boolean) {
    this.selected = id
    if (focus) void this.updateComplete.then(() => this.tab(id)?.focus())
  }

  private tab(id: SigninNetwork): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(`#tab-${id}`)
  }

  private onKeydown(e: KeyboardEvent) {
    const at = TABS.findIndex((t) => t.id === this.selected)
    let next: number
    switch (e.key) {
      case 'ArrowRight': next = (at + 1) % TABS.length; break
      case 'ArrowLeft': next = (at - 1 + TABS.length) % TABS.length; break
      case 'Home': next = 0; break
      case 'End': next = TABS.length - 1; break
      default: return
    }
    e.preventDefault()
    this.select(TABS[next]!.id, true)
  }

  override render() {
    return html`
      <div role="tablist" aria-label="Network" @keydown=${this.onKeydown}>
        ${TABS.map((t) => html`
          <button type="button" role="tab" id="tab-${t.id}"
            aria-selected=${t.id === this.selected ? 'true' : 'false'}
            aria-controls="panel-${t.id}"
            tabindex=${t.id === this.selected ? '0' : '-1'}
            @click=${() => this.select(t.id, false)}>${t.label}</button>
        `)}
      </div>
      <div role="tabpanel" id="panel-mastodon" aria-labelledby="tab-mastodon"
        ?hidden=${this.selected !== 'mastodon'}>
        <caribou-instance-picker ?add=${this.add}></caribou-instance-picker>
      </div>
      <div role="tabpanel" id="panel-bluesky" aria-labelledby="tab-bluesky"
        ?hidden=${this.selected !== 'bluesky'}>
        <caribou-bluesky-signin></caribou-bluesky-signin>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'caribou-signin-panels': CaribouSigninPanels
  }
}
