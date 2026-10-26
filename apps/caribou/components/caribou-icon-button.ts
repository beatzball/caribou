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

export type IconButtonVariant = 'default' | 'ghost'

// An icon-only button. `label` is its accessible name, so no caller can
// ship a button a screen reader announces as just "button".
//
//   <caribou-icon-button icon="star" label="Favourite" pressed="false" count="3">
//
// `hint` is the tooltip ("Sign in to boost" on a button named "Boost").
// There is no tooltip without one: a `title` equal to the name becomes the
// button's description, and a reader hears the name twice. `description` is read after the name; the text lives in this
// element's own shadow root, because an `aria-describedby` id from the
// caller's root cannot reach the inner button. `soft-disabled` is for a
// control a reader must still be able to reach and hear: it stays in the
// tab order with `aria-disabled`, and its clicks are swallowed.
//
// Parts: `button`, `icon`, `count`.
// Custom properties: `--caribou-icon-button-size` (hit area, default 2.25rem,
// 44px on a coarse pointer), `--caribou-icon-button-icon-size` (1.25em),
// `--caribou-icon-button-pressed-fg` (ghost only: the pressed colour,
// default `--accent`).
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
    button[aria-disabled="true"] { opacity: 0.6; cursor: default; }
    button[aria-disabled="true"]:hover { background: var(--bg-1); }
    button[data-variant="ghost"] { border-color: transparent; background: none; color: var(--fg-muted); }
    button[data-variant="ghost"]:hover:not(:disabled, [aria-disabled="true"]) { background: var(--bg-1); }
    /* A pressed button keeps its pressed colour under the pointer. */
    button[data-variant="ghost"]:hover:not(:disabled, [aria-disabled="true"], [aria-pressed="true"]) { color: var(--fg-0); }
    button[data-variant="ghost"][aria-disabled="true"]:hover { background: none; }
    button[data-variant="ghost"][aria-pressed="true"] { background: none; color: var(--caribou-icon-button-pressed-fg, var(--accent)); }
    button[data-variant="ghost"][aria-pressed="true"]:focus-visible { outline-color: var(--accent); }
    .sr-only {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap;
    }
  `]

  @property() icon = ''
  @property() label = ''
  @property({ converter: pressedConverter }) pressed: boolean | undefined = undefined
  @property({ type: Boolean }) disabled = false
  @property({ type: Boolean, attribute: 'soft-disabled' }) softDisabled = false
  @property() count = ''
  @property() hint = ''
  @property() description = ''
  @property() variant: IconButtonVariant = 'default'

  constructor() {
    super()
    // A click on the host's own box, outside the inner button, must not
    // reach the caller's listener while the button is disabled. A
    // soft-disabled button still gets clicks, from Enter and Space too, so
    // the same stop covers it.
    this.addEventListener('click', (e) => {
      if (this.disabled || this.softDisabled) e.stopImmediatePropagation()
    })
  }

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has('label') && !this.label) {
      devWarn(`<caribou-icon-button icon="${this.icon}">: a label is required.`)
    }
  }

  override render() {
    const ghost = this.variant === 'ghost'
    return html`<button type="button" part="button"
      data-variant=${ghost ? 'ghost' : nothing}
      aria-label=${this.label || nothing} title=${this.hint || nothing}
      aria-pressed=${this.pressed === undefined ? nothing : String(this.pressed)}
      aria-disabled=${this.softDisabled ? 'true' : nothing}
      aria-describedby=${this.description ? 'description' : nothing}
      ?disabled=${this.disabled}><caribou-icon part="icon" aria-hidden="true" name=${this.icon}
        ?filled=${ghost && this.pressed === true}></caribou-icon>${this.count
        ? html`<span class="count" part="count">${this.count}</span>` : nothing}</button><span
      class="sr-only" id="description">${this.description}</span>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-icon-button': CaribouIconButton }
}
