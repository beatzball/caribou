import { LitElement, html, css, nothing, type PropertyDeclaration, type PropertyValues } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { boxReset } from './_shared-styles.js'
import { devWarn } from './_dev-warn.js'
import './caribou-icon.js'

// `pressed` has three states. No attribute: not a toggle, so no
// `aria-pressed` at all. `pressed="false"`: a toggle that is off, which a
// screen reader must hear as "not pressed". `pressed` or `pressed="true"`:
// on. A plain boolean attribute cannot tell the first two apart.
export const pressedConverter: PropertyDeclaration['converter'] = {
  fromAttribute: (v: string | null) => v === null ? undefined : v !== 'false',
  toAttribute: (v: boolean | undefined) => v === undefined ? null : String(v),
}

// An icon-only button. `label` is its accessible name and its tooltip, so
// no caller can ship a button a screen reader announces as just "button".
//
//   <caribou-icon-button icon="star" label="Favourite" pressed="false" count="3">
//
// Parts: `button`, `icon`, `count`.
// Custom properties: `--caribou-icon-button-size` (hit area, default 2.25rem,
// 44px on a coarse pointer), `--caribou-icon-button-icon-size` (1.25em).
@customElement('caribou-icon-button')
export class CaribouIconButton extends LitElement {
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true }

  static override styles = [boxReset, css`
    :host { display: inline-flex; vertical-align: middle; }
    :host([hidden]) { display: none; }
    button {
      display: inline-flex; align-items: center; justify-content: center; gap: var(--space-1);
      min-inline-size: var(--caribou-icon-button-size, 2.25rem);
      min-block-size: var(--caribou-icon-button-size, 2.25rem);
      padding: 0 var(--space-2);
      font: inherit; color: var(--fg-0); background: var(--bg-1);
      border: 1px solid var(--border); border-radius: var(--radius-md);
      cursor: pointer;
    }
    @media (pointer: coarse) {
      button {
        min-inline-size: var(--caribou-icon-button-size, 44px);
        min-block-size: var(--caribou-icon-button-size, 44px);
      }
    }
    caribou-icon { font-size: var(--caribou-icon-button-icon-size, 1.25em); }
    .count { font-variant-numeric: tabular-nums; }
    button:hover:not(:disabled) { background: var(--bg-2); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    button[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
    /* An accent ring on an accent fill would not show. */
    button[aria-pressed="true"]:focus-visible { outline-color: var(--fg-0); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
  `]

  @property() icon = ''
  @property() label = ''
  @property({ converter: pressedConverter }) pressed: boolean | undefined = undefined
  @property({ type: Boolean }) disabled = false
  @property() count = ''

  constructor() {
    super()
    // A click on the host's own box, outside the inner button, must not
    // reach the caller's listener while the button is disabled.
    this.addEventListener('click', (e) => {
      if (this.disabled) e.stopImmediatePropagation()
    })
  }

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has('label') && !this.label) {
      devWarn(`<caribou-icon-button icon="${this.icon}">: a label is required.`)
    }
  }

  override render() {
    return html`<button type="button" part="button"
      aria-label=${this.label || nothing} title=${this.label || nothing}
      aria-pressed=${this.pressed === undefined ? nothing : String(this.pressed)}
      ?disabled=${this.disabled}><caribou-icon part="icon" aria-hidden="true" name=${this.icon}></caribou-icon>${this.count
        ? html`<span class="count" part="count">${this.count}</span>` : nothing}</button>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-icon-button': CaribouIconButton }
}
