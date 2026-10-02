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
}
