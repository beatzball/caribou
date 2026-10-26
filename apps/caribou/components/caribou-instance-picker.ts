import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
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
        body: JSON.stringify({ server }),
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
