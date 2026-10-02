// Document-level rules that no shadow root owns.
//
// The router adds the next page to the outlet with the `hidden` attribute and
// reveals it once it has rendered. The browser's own `[hidden]` rule loses to
// any author rule, and every page sets `:host { display: block }` through
// `pageReset` — so without this rule the "hidden" page is laid out under the
// current one for a frame. A document rule on the host element wins over
// `:host`.
const BASE_CSS = `litro-outlet > [hidden] { display: none; }`

export const BASE_HEAD = `<style id="caribou-base">${BASE_CSS}</style>`
