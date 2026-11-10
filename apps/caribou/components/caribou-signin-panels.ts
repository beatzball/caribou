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
 * What the reader chose and typed, shared by every mounted set of panels.
 * On a full page load the router keeps the server's page live while it
 * renders a second page hidden, then drops the first (#169). The draft
 * carries the tab, the text and the focused control across that swap. It
 * is read after the first render, never in it, so the server render and
 * the first client render stay equal.
 */
interface SigninDraft {
  selected: SigninNetwork
  /** Input `name` → value: `server` (Mastodon) and `handle` (Bluesky). */
  fields: Map<string, string>
  /** The control the reader was in: a tab's id or an input's `name`. */
  focus: string | null
}

/** The page element `start` is in: the child of `<litro-outlet>`, across shadow roots. */
function routedPage(start: Node): Element | null {
  for (let node: Node | null = start; node;) {
    const parent: Node | null = node.parentNode
    if (parent instanceof Element && parent.localName === 'litro-outlet') return node as Element
    node = parent instanceof ShadowRoot ? parent.host : parent
  }
  return null
}

let draft: SigninDraft = { selected: 'mastodon', fields: new Map(), focus: null }
const mounted = new Set<CaribouSigninPanels>()

/**
 * True once a page has been shown and had its focus put back. The swap
 * happens once per page load, so from then on a `focusin` records nothing:
 * a later visit (Cancel, /home, Back) starts at the outlet, as the router
 * means it to (#246).
 */
let focusRestored = false

/** Tests only: forget the reader's draft. */
export function resetSigninDraft() {
  draft = { selected: 'mastodon', fields: new Map(), focus: null }
  focusRestored = false
}

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

  private _shown?: MutationObserver

  // On the shadow root, not the host: focus moving from a tab to a field is
  // inside this element, so the browser does not send `focusin` to the host
  // (its target and related target are both the host there). Here because a
  // hydrating element has no render root yet in `connectedCallback`.
  protected override createRenderRoot() {
    const root = super.createRenderRoot()
    root.addEventListener('input', this.onInput)
    root.addEventListener('focusin', this.onFocusin as EventListener)
    return root
  }

  override connectedCallback() {
    super.connectedCallback()
    mounted.add(this)
  }

  override disconnectedCallback() {
    mounted.delete(this)
    this._shown?.disconnect()
    this._shown = undefined
    super.disconnectedCallback()
  }

  protected override firstUpdated() {
    void this.restore()
    // The router renders this page hidden, shows it, then focuses its outlet.
    // Put the reader back in the control they were in, once it is shown. A
    // MutationObserver callback runs after the router's synchronous
    // `removeAttribute('hidden')` + `outlet.focus()`, as in
    // `caribou-instance-picker.ts`.
    const page = routedPage(this)
    if (!page?.hasAttribute('hidden')) return
    this._shown = new MutationObserver(() => {
      if (page.hasAttribute('hidden')) return
      this._shown?.disconnect()
      this._shown = undefined
      if (this.isConnected) this.restoreFocus()
    })
    this._shown.observe(page, { attributes: true, attributeFilter: ['hidden'] })
  }

  private input(name: string): HTMLInputElement | null {
    for (const child of this.renderRoot.querySelectorAll('caribou-instance-picker, caribou-bluesky-signin')) {
      const input = child.shadowRoot?.querySelector<HTMLInputElement>(`input[name="${name}"]`)
      if (input) return input
    }
    return null
  }

  /** Bring this set of panels up to the draft. */
  private async restore() {
    if (this.selected !== draft.selected) this.selected = draft.selected
    await this.updateComplete
    for (const child of this.renderRoot.querySelectorAll('caribou-instance-picker, caribou-bluesky-signin')) {
      await (child as LitElement).updateComplete
    }
    for (const [name, value] of draft.fields) {
      const input = this.input(name)
      if (input && input.value !== value) input.value = value
    }
  }

  private restoreFocus() {
    // Once: before the focus, so its `focusin` records nothing.
    focusRestored = true
    const at = draft.focus
    draft.focus = null
    if (!at) return
    const target = at.startsWith('tab-') ? this.renderRoot.querySelector<HTMLElement>(`#${at}`) : this.input(at)
    target?.focus()
  }

  private others(): CaribouSigninPanels[] {
    return [...mounted].filter((p) => p !== this)
  }

  private onInput = (e: Event) => {
    const input = e.composedPath()[0]
    if (!(input instanceof HTMLInputElement) || !input.name) return
    draft.fields.set(input.name, input.value)
    for (const p of this.others()) void p.restore()
  }

  private onFocusin = (e: FocusEvent) => {
    if (focusRestored) return
    const el = e.composedPath()[0]
    if (el instanceof HTMLInputElement && el.name) draft.focus = el.name
    else if (el instanceof HTMLElement && el.getAttribute('role') === 'tab') draft.focus = el.id
  }

  private select(id: SigninNetwork, focus: boolean) {
    this.selected = id
    draft.selected = id
    for (const p of this.others()) void p.restore()
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
