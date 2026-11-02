import { html, type TemplateResult } from 'lit'
import './caribou-settings-appearance.js'
import './caribou-settings-timeline.js'
import './caribou-settings-account.js'

// The sections of /settings, in page order. `<caribou-settings>` renders each
// one as `<section id=${id}>` with an `<h2>` of `heading`, then `render()`.
//
// To add a section:
// 1. Write its element, `components/caribou-settings-<name>.ts`. It renders
//    only its controls: the heading comes from here. It is rendered in the
//    browser only (the page shows the settings after it has read the
//    session), so it may read `localStorage` when it connects. Save a
//    per-account preference with `updatePrefs(userKey, { … })` from
//    `@beatzball/caribou-state`, which keeps the other keys.
// 2. Import it above and add one entry below. `id` is also the URL fragment
//    (`/settings#<id>`), so keep it short and stable.
export interface SettingsSection {
  id: string
  heading: string
  render: () => TemplateResult
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'appearance',
    heading: 'Appearance',
    render: () => html`<caribou-settings-appearance></caribou-settings-appearance>`,
  },
  {
    id: 'timeline',
    heading: 'Timeline',
    render: () => html`<caribou-settings-timeline></caribou-settings-timeline>`,
  },
  {
    id: 'account',
    heading: 'Account',
    render: () => html`<caribou-settings-account></caribou-settings-account>`,
  },
]
