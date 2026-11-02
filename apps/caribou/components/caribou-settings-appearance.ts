import { LitElement, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { live } from 'lit/directives/live.js'
import type { ThemePref } from '@beatzball/caribou-state'
import { currentThemePref, setThemePref } from './_theme.js'
import { choiceStyles } from './_settings-styles.js'

const OPTIONS: Array<{ value: ThemePref; label: string; hint?: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System', hint: '(follows your device)' },
]

// The theme, for the active account. A choice applies at once
// (`setThemePref`), and the head script applies it on the next page load
// before the first paint.
@customElement('caribou-settings-appearance')
export class CaribouSettingsAppearance extends LitElement {
  static override styles = choiceStyles

  @state() private theme: ThemePref = 'dark'
  @state() private status = ''

  override connectedCallback() {
    super.connectedCallback()
    if (typeof window !== 'undefined') this.theme = currentThemePref()
  }

  private onChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value as ThemePref
    if (setThemePref(value)) {
      this.theme = value
      this.status = ''
    } else {
      // The browser has checked the new radio; `live` puts the stored one back.
      this.theme = currentThemePref()
      this.status = 'Not saved. This browser did not let Caribou store the setting.'
      this.requestUpdate()
    }
  }

  override render() {
    return html`
      <fieldset>
        <legend>Theme</legend>
        ${OPTIONS.map((o) => html`
          <label>
            <input type="radio" name="theme" value=${o.value} .checked=${live(this.theme === o.value)} @change=${this.onChange} />
            ${o.label}${o.hint ? html` <span class="hint">${o.hint}</span>` : ''}
          </label>`)}
      </fieldset>
      <p class="status" role="status">${this.status}</p>
    `
  }
}
