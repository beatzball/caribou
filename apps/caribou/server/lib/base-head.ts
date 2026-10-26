// Document-level rules that no shadow root owns.
//
// The router adds the next page to the outlet with the `hidden` attribute and
// reveals it once it has rendered. The browser's own `[hidden]` rule loses to
// any author rule, and every page sets `:host { display: block }` through
// `pageReset` — so without this rule the "hidden" page is laid out under the
// current one for a frame. A document rule on the host element wins over
// `:host`.
const BASE_CSS = `litro-outlet > [hidden] { display: none; }`

// Litro's shell writes its own viewport meta first; the last one wins. With
// viewport-fit=cover the page reaches the screen edges and `env(safe-area-*)`
// reports the home indicator and notch, so the mobile nav bar and the shell
// can keep their controls out of those zones.
const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />'

export const BASE_HEAD = `${VIEWPORT}<style id="caribou-base">${BASE_CSS}</style>`
