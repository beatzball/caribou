import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { boxReset } from './_shared-styles.js'

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
    button {
      padding: var(--space-3); border-radius: var(--radius-md);
      border: 0; background: var(--accent); color: var(--accent-fg); cursor: pointer;
    }
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
        <button type="submit" ?disabled=${this.submitting}>
          ${this.submitting ? 'Connecting…' : 'Sign in'}
        </button>
        ${this.error ? html`<p role="alert">${this.error}</p>` : nothing}
      </form>
    `
  }
}
