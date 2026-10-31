import { html } from 'lit'

// Inline SVG icons. Each one is a static template, so the same value can be
// rendered in any number of places and server-renders with no directive.
//
// Bodies are copied verbatim from @iconify-json/lucide; viewBox/size are
// uniform across the lucide set (24×24, 1em sizing).

export const ICONS = {
  home: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></g></svg>`,
  users: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3.128a4 4 0 0 1 0 7.744M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/></g></svg>`,
  globe: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20a14.5 14.5 0 0 0 0-20M2 12h20"/></g></svg>`,
  user: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></g></svg>`,
  logOut: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m16 17l5-5l-5-5m5 5H9m0 9H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/></svg>`,
  repeat2: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m2 9l3-3l3 3"/><path d="M13 18H7a2 2 0 0 1-2-2V6m17 9l-3 3l-3-3"/><path d="M11 6h6a2 2 0 0 1 2 2v10"/></g></svg>`,
  messageCircle: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`,
  star: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.12 2.12 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.12 2.12 0 0 0 1.597-1.16z"/></svg>`,
  bookmark: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19 21l-7-4l-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/></svg>`,
  x: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M6 6l12 12"/></svg>`,
  triangleAlert: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4m0 4h.01"/></svg>`,
  image: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></g></svg>`,
  squarePen: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></g></svg>`,
  ellipsis: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></g></svg>`,
  bell: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></g></svg>`,
  userPlus: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></g></svg>`,
  chartColumn: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></g></svg>`,
  atSign: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></g></svg>`,
  check: html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 6L9 17l-5-5"/></svg>`,
}
