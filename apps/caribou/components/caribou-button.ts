import { LitElement, html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { boxReset } from './_shared-styles.js'

export type ButtonVariant = 'primary' | 'secondary' | 'danger'

// A text button. With `type="submit"` it submits the form it sits in, like a
// native submit button, through ElementInternals.
//
//   <caribou-button variant="primary" type="submit" ?loading=${busy}>Post</caribou-button>
//
// `loading` keeps the button focusable (so focus is not lost mid-action) but
// marks it busy and swallows clicks. `disabled` takes it out of use entirely.
//
// Parts: `button`, `spinner`.
// Custom properties: `--caribou-button-size` (min height, default 2.25rem,
// 44px on a coarse pointer), `--caribou-button-bg`, `--caribou-button-fg`.
@customElement('caribou-button')
export class CaribouButton extends LitElement {
  static formAssociated = true
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true }

  static override styles = [boxReset, css`
    :host { display: inline-flex; vertical-align: middle; }
    :host([hidden]) { display: none; }
    button {
      --_bg: var(--caribou-button-bg, var(--bg-1));
      --_fg: var(--caribou-button-fg, var(--fg-0));
      display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
      inline-size: 100%;
      min-block-size: var(--caribou-button-size, 2.25rem);
      padding: var(--space-2) var(--space-3);
      font: inherit; color: var(--_fg); background: var(--_bg);
      border: 1px solid var(--border); border-radius: var(--radius-md);
      cursor: pointer;
    }
    @media (pointer: coarse) {
      button { min-block-size: var(--caribou-button-size, 44px); }
    }
    button[data-variant="primary"] {
      --_bg: var(--caribou-button-bg, var(--accent));
      --_fg: var(--caribou-button-fg, var(--accent-fg));
      border-color: transparent;
    }
    button[data-variant="danger"] {
      --_bg: var(--caribou-button-bg, var(--danger));
      --_fg: var(--caribou-button-fg, var(--bg-0));
      border-color: transparent;
    }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    /* An accent ring on an accent fill would not show. */
    button[data-variant="primary"]:focus-visible { outline-color: var(--fg-0); }
    button:disabled, button[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
    button[aria-busy="true"] { cursor: progress; }
    .spinner {
      inline-size: 1em; block-size: 1em; flex: none;
      border: 2px solid currentColor; border-inline-end-color: transparent; border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @media (prefers-reduced-motion: reduce) {
      .spinner { animation-duration: 2.4s; }
    }
    @keyframes spin { to { transform: rotate(1turn); } }
  `]

  @property({ reflect: true }) variant: ButtonVariant = 'secondary'
  @property() type: 'button' | 'submit' = 'button'
  @property({ type: Boolean }) disabled = false
  @property({ type: Boolean }) loading = false

  // Set by a disabled <fieldset> around the button.
  private formDisabled = false
  // The server's DOM shim may have no attachInternals.
  private internals: ElementInternals | null =
    typeof this.attachInternals === 'function' ? this.attachInternals() : null

  constructor() {
    super()
    // Runs before any listener the caller adds, so a busy or disabled button
    // never reports a click. Covers a click on the host's own box too.
    this.addEventListener('click', this.onClick)
  }

  formDisabledCallback(disabled: boolean) {
    this.formDisabled = disabled
    this.requestUpdate()
  }

  get form(): HTMLFormElement | null {
    return this.internals?.form ?? this.closest('form')
  }

  private onClick = (e: MouseEvent) => {
    if (this.disabled || this.formDisabled || this.loading) {
      e.preventDefault()
      e.stopImmediatePropagation()
      return
    }
    if (this.type === 'submit') this.form?.requestSubmit()
  }

  override render() {
    const blocked = this.disabled || this.formDisabled
    return html`<button type="button" part="button" data-variant=${this.variant}
      ?disabled=${blocked}
      aria-disabled=${this.loading && !blocked ? 'true' : nothing}
      aria-busy=${this.loading ? 'true' : nothing}>${this.loading
        ? html`<span class="spinner" part="spinner" aria-hidden="true"></span>` : nothing}<slot></slot></button>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-button': CaribouButton }
}
