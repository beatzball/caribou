import { css } from 'lit'

// The document stylesheet sets `* { box-sizing: border-box }`, but a document
// rule does not cross a shadow boundary. Every component that renders its own
// markup composes this so its box model matches the page's.
export const boxReset = css`
  *, *::before, *::after { box-sizing: border-box; }
`

// Mastodon wraps a link's text in spans: the scheme and `www.` in
// `.invisible`, the shown part in `.ellipsis` when it cut a long path. Shrink
// the hidden parts to nothing and mark the cut. The hidden text stays in the
// link, so its accessible name and a copy of its text are the full URL;
// `display: none` would drop it from both. Mastodon's own rule adds
// `inline-block` and `position: absolute`, which make Chromium put spaces
// into the name; a plain inline span at size 0 does not. The "…" has empty
// alt text, so it is not read as part of the URL. Only remote HTML uses
// these class names, so compose this where that HTML renders.
export const mastodonLinkText = css`
  .invisible { font-size: 0; line-height: 0; }
  .ellipsis::after { content: "…"; content: "…" / ""; }
`
