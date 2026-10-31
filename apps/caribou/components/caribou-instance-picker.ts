import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { boxReset } from './_shared-styles.js'
import './caribou-button.js'

@customElement('caribou-instance-picker')
export class CaribouInstancePicker extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; }
    form { display: flex; flex-direction: column; gap: var(--space-3); max-width: 400px; margin: 0 auto; }
    label { color: var(--fg-1); }
    input {
      padding: var(--space-3); border-radius: var(--radius-md);
      border: 1px solid var(--border); background: var(--bg-1); color: var(--fg-0);
    }
    caribou-button { --caribou-button-size: 2.75rem; }
    [role="alert"] { color: var(--danger); margin: 0; }
  `]

  // Adds an account while signed in: the server sends an error back to
  // `/?add`, and the field takes focus when the form opens.
  @property({ type: Boolean }) add = false

  @state() private submitting = false
  @state() private error: string | null = null

  private async onSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (this.submitting) return
    const form = e.currentTarget as HTMLFormElement
    const input = form.querySelector<HTMLInputElement>('input[name="server"]')!
    const server = input.value.trim()
    if (!server) return
    this.submitting = true
    this.error = null
    try {
      const res = await fetch('/api/signin/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.add ? { server, add: true } : { server }),
      })
      if (!res.ok) {
        this.error = 'Could not reach that instance. Check the spelling and try again.'
        return
      }
      const { authorizeUrl } = (await res.json()) as { authorizeUrl: string }
      location.href = authorizeUrl
    } catch {
      this.error = 'Network error — try again.'
    } finally {
      this.submitting = false
    }
  }

  // The account menu's "Add account" link opens this form to type in, so
  // the field takes focus. Not `autofocus`: a browser honours it only once
  // per document, and a client-side navigation inserts the form later.
  //
  // On a client-side navigation the router renders the next page hidden,
  // shows it, and then focuses its outlet (`<litro-outlet>`) so keyboard
  // users start at the top. The field takes the focus once the page is
  // shown: a MutationObserver callback runs after the router's synchronous
  // `removeAttribute('hidden')` + `outlet.focus()`. Not the outlet's
  // `focus` event: it does not fire when the outlet already has the focus,
  // as in Safari after a mouse click on a menu button (Safari does not
  // focus a clicked button). A page that is never shown (a newer
  // navigation won) never takes the focus.
  private _shown?: MutationObserver

  override connectedCallback() {
    super.connectedCallback()
    if (!this.add) return
    const focusField = () => {
      if (this.isConnected) this.renderRoot.querySelector<HTMLInputElement>('input[name="server"]')?.focus()
    }
    const page = routedPage(this)
    if (page?.hasAttribute('hidden')) {
      this._shown = new MutationObserver(() => {
        if (page.hasAttribute('hidden')) return
        this._shown?.disconnect()
        this._shown = undefined
        void this.updateComplete.then(focusField)
      })
      this._shown.observe(page, { attributes: true, attributeFilter: ['hidden'] })
    } else {
      void this.updateComplete.then(focusField)
    }
  }

  override disconnectedCallback() {
    this._shown?.disconnect()
    this._shown = undefined
    super.disconnectedCallback()
  }

  override render() {
    return html`
      <form @submit=${this.onSubmit}>
        <label for="server">Your Mastodon instance</label>
        <input id="server" name="server" type="text" autocomplete="off"
               placeholder="mastodon.social"
               required />
        <!-- The form has no action: without JS it has nowhere to go, so a
             submit that needs JS (see caribou-button) loses nothing.
             Enter submits only while this is the form's one text field. -->
        <caribou-button variant="primary" type="submit" ?loading=${this.submitting}>
          ${this.submitting ? 'Connecting…' : 'Sign in'}
        </caribou-button>
        ${this.error ? html`<p role="alert">${this.error}</p>` : nothing}
      </form>
    `
  }
}

/** The page element `node` is in: the child of `<litro-outlet>`, across shadow roots. */
function routedPage(node: Node): Element | null {
  let n: Node | null = node
  while (n) {
    const parent: Node | null = n.parentNode
    if (parent instanceof Element && parent.localName === 'litro-outlet') return n as Element
    n = parent instanceof ShadowRoot ? parent.host : parent
  }
  return null
}
