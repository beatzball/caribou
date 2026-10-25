import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
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
    button:hover:not(:disabled, [aria-disabled="true"]) { background: color-mix(in srgb, var(--_bg) 85%, var(--fg-0)); }
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
  // Reflected: the browser folds the host's own `disabled` attribute into
  // formDisabledCallback, so the property must move the attribute or
  // `el.disabled = false` could never undo it.
  @property({ type: Boolean, reflect: true }) disabled = false
  @property({ type: Boolean }) loading = false

  // From formDisabledCallback: a disabled <fieldset> around the button, or
  // the host's own `disabled`. The server never has it, so render() must
  // not read it; updated() puts it on the button.
  private formDisabled = false

  @query('button') private buttonEl?: HTMLButtonElement
  // The server's DOM shim may have no attachInternals.
  private internals: ElementInternals | null =
    typeof this.attachInternals === 'function' ? this.attachInternals() : null

  constructor() {
    super()
    // Runs before any listener the caller adds, so a busy or disabled button
    // never reports a click. Covers a click on the host's own box too.
    this.addEventListener('click', this.onClick)
  }

  private get blocked(): boolean {
    return this.disabled || this.formDisabled || this.loading
  }

  formDisabledCallback(disabled: boolean) {
    this.formDisabled = disabled
    this.requestUpdate()
  }

  // A null form from the internals is an answer (say `form="missing"`),
  // not a reason to fall back on the nearest form.
  get form(): HTMLFormElement | null {
    return this.internals ? this.internals.form : this.closest('form')
  }

  private onClick = (e: MouseEvent) => {
    if (this.blocked) {
      e.preventDefault()
      e.stopImmediatePropagation()
      return
    }
    if (this.type !== 'submit') return
    // Like a native submit button: submit once the click has reached every
    // listener, and only if none of them cancelled it. A microtask is not
    // late enough; for a real click it runs between listeners.
    setTimeout(() => {
      if (!e.defaultPrevented && !this.blocked && this.isConnected) this.form?.requestSubmit()
    })
  }

  protected override updated() {
    // After hydration too: Lit adopts the server's attributes without
    // writing its own values, so this is what disables a server-rendered
    // button inside a disabled fieldset.
    if (this.buttonEl) this.buttonEl.disabled = this.disabled || this.formDisabled
  }

  override render() {
    return html`<button type="button" part="button" data-variant=${this.variant}
      ?disabled=${this.disabled}
      aria-disabled=${this.loading && !this.disabled ? 'true' : nothing}
      aria-busy=${this.loading ? 'true' : nothing}>${this.loading
        ? html`<span class="spinner" part="spinner" aria-hidden="true"></span>` : nothing}<slot></slot></button>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-button': CaribouButton }
}
