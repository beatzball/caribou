import { LitElement, html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { live } from 'lit/directives/live.js'
import { activeUserKey, readPrefs, shortcutsOf, updatePrefs } from '@beatzball/caribou-state'
import { choiceStyles } from './_settings-styles.js'
import './caribou-button.js'

// Turns the keyboard shortcuts (`components/_shortcuts.ts`) on or off for
// the active account. On is the default; the shortcuts read the setting at
// each key press, so a change applies at once.
@customElement('caribou-settings-keyboard')
export class CaribouSettingsKeyboard extends LitElement {
  static override styles = [choiceStyles, css`
    caribou-button { margin-top: var(--space-2); }
  `]

  @state() private on = true
  @state() private status = ''

  override connectedCallback() {
    super.connectedCallback()
    const key = typeof window !== 'undefined' ? activeUserKey.peek() : null
    if (key) this.on = shortcutsOf(readPrefs(key))
  }

  private onChange = (e: Event) => {
    const on = (e.target as HTMLInputElement).checked
    const key = activeUserKey.peek()
    if (key && updatePrefs(key, { shortcuts: on })) {
      this.on = on
      this.status = ''
    } else {
      // The browser has changed the box; `live` puts the stored value back.
      this.on = key ? shortcutsOf(readPrefs(key)) : true
      this.status = 'Not saved. This browser did not let Caribou store the setting.'
      this.requestUpdate()
    }
  }

  private onShow = () => {
    window.dispatchEvent(new CustomEvent('caribou:shortcuts-help'))
  }

  override render() {
    return html`
      <label>
        <input type="checkbox" name="shortcuts" .checked=${live(this.on)} @change=${this.onChange} />
        Use keyboard shortcuts
      </label>
      <caribou-button variant="secondary" class="show" @click=${this.onShow}>Show keyboard shortcuts</caribou-button>
      <p class="status" role="status">${this.status}</p>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-settings-keyboard': CaribouSettingsKeyboard }
}
