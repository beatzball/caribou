import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { boxReset } from './_shared-styles.js'
import { devWarn } from './_dev-warn.js'
import './caribou-icon.js'

// A button that opens a small menu of links and buttons.
//
//   <caribou-menu icon="ellipsis" label="More">
//     <a href="/public">Public</a>
//     <form action="/api/signout" method="post"><button>Sign out</button></form>
//   </caribou-menu>
//
// The items are the caller's own light DOM, slotted into the panel, so the
// caller styles them and a native form in the menu still submits without
// JavaScript. The panel is a native popover and the trigger names it with
// `popovertarget`, so the browser opens it, dismisses it on Escape or a
// click outside, and exposes the expanded state, all with JavaScript off.
// That is also why the trigger is a native button in this root and not a
// `<caribou-icon-button>`: an id reference cannot reach into another
// shadow root.
//
// With JavaScript the element keeps `aria-expanded` set, focuses the first
// item on open, returns focus to the trigger when the menu closes from
// inside it, and closes the menu when an item is chosen or focus leaves it. A browser without
// the Popover API gets the same behaviour from a script fallback.
//
// The panel is fixed to the viewport's bottom-right corner, where the phone
// nav bar puts its trigger. `--caribou-menu-bottom` and
// `--caribou-menu-right` move it; set `--caribou-menu-right: auto` and
// `--caribou-menu-left` to put it on the left. It never grows past the viewport.
//
// The `trigger` slot replaces the icon inside the trigger, for a trigger that
// shows more than an icon (the account button). The label is still the
// trigger's name, read before the slotted content.
//
// Parts: `trigger`, `icon`, `panel`.
@customElement('caribou-menu')
export class CaribouMenu extends LitElement {
  // Read once. The method, not the `popover` property: happy-dom has the
  // property but cannot show a popover.
  static popoverSupported = typeof HTMLElement !== 'undefined'
    && typeof HTMLElement.prototype.showPopover === 'function'

  static override styles = [boxReset, css`
    :host { display: inline-flex; }
    :host([hidden]) { display: none; }
    .trigger {
      display: flex; align-items: center; justify-content: center;
      min-inline-size: 44px; min-block-size: 44px; padding: var(--space-2);
      font: inherit; color: var(--fg-1); background: transparent;
      border: 0; border-radius: var(--radius-md); cursor: pointer;
    }
    .trigger:hover { background: var(--bg-1); }
    .trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .trigger[aria-expanded="true"] { background: var(--bg-2); color: var(--fg-0); }
    caribou-icon { font-size: 20px; }
    /* Link-hint tools (Vimium) test the element at the trigger's center. A
       nested shadow root or a slotted node there reads as covering the
       button, so the hint is lost (#111). Clicks go to the button itself. */
    .trigger caribou-icon, ::slotted([slot="trigger"]) { pointer-events: none; }
    .label {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap;
    }
    .panel {
      /* Closed until opened. Two rules, not one list: a browser without
         :popover-open would drop the whole list and never show the panel. */
      display: none; flex-direction: column; gap: var(--space-1);
      position: fixed; margin: 0;
      inset: auto var(--caribou-menu-right, var(--space-2)) var(--caribou-menu-bottom, var(--space-2)) var(--caribou-menu-left, auto);
      min-inline-size: min(12rem, calc(100vw - 2 * var(--space-2)));
      max-inline-size: calc(100vw - 2 * var(--space-2));
      max-block-size: calc(100vh - var(--caribou-menu-bottom, var(--space-2)) - var(--space-2));
      max-block-size: calc(100dvh - var(--caribou-menu-bottom, var(--space-2)) - var(--space-2));
      overflow: auto; padding: var(--space-1);
      color: var(--fg-1); background: var(--bg-0);
      border: 1px solid var(--border); border-radius: var(--radius-md);
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.25);
      z-index: 100;
    }
    .panel:popover-open { display: flex; }
    .panel[data-open] { display: flex; }
  `]

  @property() label = ''
  @property() icon = ''

  private _open = false
  // Whether focus was inside when the menu began to close. Read before the
  // panel hides, because hiding it drops focus from a focused item.
  private _hadFocus = false
  private _pressing = false

  get open(): boolean { return this._open }

  show() { this.setOpen(true) }
  hide() { this.setOpen(false) }

  constructor() {
    super()
    // An item click bubbles here from the slotted light DOM; the trigger's
    // click comes from this shadow root and is left to the popover.
    this.addEventListener('click', (e) => {
      for (const node of e.composedPath()) {
        if (node === this) return
        if (node instanceof Element && node.matches('a[href], button') && node !== this.trigger) {
          this.hide()
          return
        }
      }
    })
    this.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._open && !CaribouMenu.popoverSupported) this.hide()
    })
    // Tab past the last item leaves the menu, so the menu closes rather than
    // cover the page under the new focus. `relatedTarget` is retargeted to
    // this host when focus moves to the trigger. Presses are left to the
    // light dismiss and the click: Safari does not focus a pressed button
    // or link, it moves focus to a focusable ancestor outside the menu,
    // and closing then would swallow the press. The mark lasts until the
    // click, because a touch moves focus after `pointerup`.
    this.addEventListener('pointerdown', () => { this._pressing = true })
    this.addEventListener('click', () => { this._pressing = false })
    this.addEventListener('keydown', () => { this._pressing = false })
    this.addEventListener('focusout', (e) => {
      const to = e.relatedTarget
      if (this._open && !this._pressing && to instanceof Node && to !== this && !this.contains(to)) this.hide()
    })
  }

  override connectedCallback() {
    super.connectedCallback()
    if (!CaribouMenu.popoverSupported) document.addEventListener('pointerdown', this.onOutside)
  }

  override disconnectedCallback() {
    document.removeEventListener('pointerdown', this.onOutside)
    super.disconnectedCallback()
  }

  protected override willUpdate() {
    if (!this.label) devWarn(`<caribou-menu icon="${this.icon}">: a label is required.`)
  }

  // Not in the template: rendered as "false", it would stay "false" on an
  // open menu without JavaScript and hide the state the browser exposes.
  protected override firstUpdated() {
    this.trigger?.setAttribute('aria-expanded', 'false')
  }

  private get trigger() { return this.renderRoot.querySelector<HTMLButtonElement>('.trigger') }
  private get panel() { return this.renderRoot.querySelector<HTMLElement>('.panel') }

  private setOpen(open: boolean) {
    const panel = this.panel
    if (!panel || open === this._open) return
    if (CaribouMenu.popoverSupported) {
      // beforetoggle and toggle run the rest.
      if (open) panel.showPopover()
      else panel.hidePopover()
      return
    }
    this.beforeChange(open)
    panel.toggleAttribute('data-open', open)
    this.afterChange(open)
  }

  private beforeChange(open: boolean) {
    if (!open) this._hadFocus = this.matches(':focus-within')
  }

  private afterChange(open: boolean) {
    this._open = open
    this.trigger?.setAttribute('aria-expanded', String(open))
    if (open) this.firstItem()?.focus()
    else if (this._hadFocus) this.trigger?.focus()
    this._hadFocus = false
  }

  private firstItem(): HTMLElement | null {
    for (const el of this.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')) {
      if (el.checkVisibility?.() ?? true) return el
    }
    return null
  }

  private onTriggerClick = () => {
    if (!CaribouMenu.popoverSupported) this.setOpen(!this._open)
  }

  private onBeforeToggle = (e: Event) => this.beforeChange((e as ToggleEvent).newState === 'open')
  private onToggle = (e: Event) => this.afterChange((e as ToggleEvent).newState === 'open')

  private onOutside = (e: PointerEvent) => {
    if (this._open && !e.composedPath().includes(this)) this.hide()
  }

  override render() {
    return html`<button type="button" class="trigger" part="trigger" popovertarget="panel"
      aria-controls="panel" @click=${this.onTriggerClick}><span class="label">${this.label}</span><slot
      name="trigger"><caribou-icon part="icon" name=${this.icon}></caribou-icon></slot></button><div
      id="panel" class="panel" part="panel" popover @beforetoggle=${this.onBeforeToggle}
      @toggle=${this.onToggle}><slot></slot></div>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-menu': CaribouMenu }
}
