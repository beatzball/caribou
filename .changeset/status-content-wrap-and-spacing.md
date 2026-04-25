---
'@beatzball/caribou-design-tokens': patch
---

Add `.status-content` rules to `tokens.css` so sanitized post HTML wraps and adjacent links separate visually.

- `overflow-wrap: anywhere; word-break: break-word; min-width: 0` on `.status-content`, `.status-content > p`, and `.status-content a`. Long unbreakable runs (stacks of hashtag/mention `<a>` links, raw URLs) were pushing the timeline off-screen on narrow viewports; `overflow-wrap` on the parent alone wasn't enough because the actual line boxes live on the `<p>`/`<a>` descendants emitted by Mastodon.
- `margin-inline-start: 0.25em` on `.status-content a + a`. Mastodon emits author-typed `#AI#Tech` (no source whitespace) as `<a>#AI</a><a>#Tech</a>` with no whitespace text node between them, so the rendered tokens visually merged into one underlined run. Margins live outside the link's content area, so the underline ends with each link instead of extending across an injected space.
