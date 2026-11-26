import { LitElement, html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { live } from 'lit/directives/live.js'
import { effect } from '@preact/signals-core'
import type { ThemePref } from '@beatzball/caribou-state'
import { currentThemePref, setThemePref } from './_theme.js'
import { currentTextSize, setTextSize, textSize, type TextSize } from './_text-size.js'
import { choiceStyles } from './_settings-styles.js'

const OPTIONS: Array<{ value: ThemePref; label: string; hint?: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System', hint: '(follows your device)' },
]

// Smaller to larger, as in `TEXT_SIZES`.
const TEXT_SIZE_OPTIONS: Array<{ value: TextSize; label: string }> = [
  { value: 'xs', label: 'Smallest' },
  { value: 'sm', label: 'Smaller' },
  { value: 'md', label: 'Default' },
  { value: 'lg', label: 'Larger' },
  { value: 'xl', label: 'Largest' },
]

const NOT_SAVED = 'Not saved. This browser did not let Caribou store the setting.'

// The theme, for the active account, and the text size, for this device.
// A choice applies at once (`setThemePref`, `setTextSize`), and the head
// scripts apply it on the next page load before the first paint. The whole
// page is the text size's preview; the sample post under its radios shows
// post text even here. The sample is hidden from assistive technology: it
// only shows the size, and the checked radio already says which one.
@customElement('caribou-settings-appearance')
export class CaribouSettingsAppearance extends LitElement {
  static override styles = [choiceStyles, css`
    fieldset + fieldset { margin-top: var(--space-4); }
    .about { margin: 0 0 var(--space-2); padding: 0 var(--space-2); color: var(--fg-muted); font-size: 0.875em; }
    .sample {
      display: flex; gap: var(--space-3); margin: var(--space-2) 0 0; padding: var(--space-3);
      border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-1);
    }
    .sample-avatar { width: 48px; height: 48px; flex: none; border-radius: var(--radius-md); background: var(--bg-2); }
    .sample-body { min-width: 0; }
    .sample-header { display: flex; flex-wrap: wrap; gap: 0 var(--space-2); align-items: baseline; }
    .sample-name { color: var(--fg-0); font-weight: 700; }
    .sample-acct { color: var(--fg-muted); overflow-wrap: anywhere; }
    .sample-text { margin: var(--space-2) 0 0; color: var(--fg-0); overflow-wrap: anywhere; }
  `]

  @state() private theme: ThemePref = 'dark'
  @state() private size: TextSize = 'md'
  @state() private status = ''

  private stopSize?: () => void

  override connectedCallback() {
    super.connectedCallback()
    if (typeof window === 'undefined') return
    this.theme = currentThemePref()
    // Read storage again, then follow the shown size: another tab can change
    // it while this page is open (`startTextSize`).
    textSize.value = currentTextSize()
    this.stopSize = effect(() => { this.size = textSize.value })
  }

  override disconnectedCallback() {
    this.stopSize?.()
    this.stopSize = undefined
    super.disconnectedCallback()
  }

  private onChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value as ThemePref
    if (setThemePref(value)) {
      this.theme = value
      this.status = ''
    } else {
      // The browser has checked the new radio; `live` puts the stored one back.
      this.theme = currentThemePref()
      this.status = NOT_SAVED
      this.requestUpdate()
    }
  }

  private onSizeChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value as TextSize
    if (setTextSize(value)) {
      this.size = value
      this.status = ''
    } else {
      this.size = currentTextSize()
      this.status = NOT_SAVED
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
      <fieldset aria-describedby="text-size-about">
        <legend>Text size</legend>
        <p class="about" id="text-size-about">Applies on this device, for every account.</p>
        ${TEXT_SIZE_OPTIONS.map((o) => html`
          <label>
            <input type="radio" name="text-size" value=${o.value} .checked=${live(this.size === o.value)} @change=${this.onSizeChange} />
            ${o.label}
          </label>`)}
        <div class="sample" aria-hidden="true">
          <div class="sample-avatar"></div>
          <div class="sample-body">
            <div class="sample-header">
              <span class="sample-name">Alice Example</span>
              <span class="sample-acct">@alice@example.social</span>
            </div>
            <p class="sample-text">This is how posts look at this size. Names, menus and the compose box change with it.</p>
          </div>
        </div>
      </fieldset>
      <p class="status" role="status">${this.status}</p>
    `
  }
}
