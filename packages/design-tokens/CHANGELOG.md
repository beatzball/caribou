# @beatzball/caribou-design-tokens

## 0.0.2

### Patch Changes

- [#14](https://github.com/beatzball/caribou/pull/14) [`e833419`](https://github.com/beatzball/caribou/commit/e833419093741d780e822e817cbd7e7f8986a336) Thanks [@beatzball](https://github.com/beatzball)! - Drop the `.status-content` wrap and adjacent-link rules from `tokens.css`.

  These selectors only ever needed to reach inside `caribou-status-card`'s rendered post HTML. Now that the card uses shadow DOM (see `caribou-elena` patch), global CSS no longer crosses into its rendered tree — keeping the rules in the global tokens stylesheet would silently apply to nothing. The card adopts its own copy of the rules onto its shadow root via Elena's `static styles`.

- [#13](https://github.com/beatzball/caribou/pull/13) [`3b8baed`](https://github.com/beatzball/caribou/commit/3b8baed1f40343bd3dc44149c41a54417193b467) Thanks [@beatzball](https://github.com/beatzball)! - Add `.status-content` rules to `tokens.css` so sanitized post HTML wraps and adjacent links separate visually.
  - `overflow-wrap: anywhere; word-break: break-word; min-width: 0` on `.status-content`, `.status-content > p`, and `.status-content a`. Long unbreakable runs (stacks of hashtag/mention `<a>` links, raw URLs) were pushing the timeline off-screen on narrow viewports; `overflow-wrap` on the parent alone wasn't enough because the actual line boxes live on the `<p>`/`<a>` descendants emitted by Mastodon.
  - `margin-inline-start: 0.25em` on `.status-content a + a`. Mastodon emits author-typed `#AI#Tech` (no source whitespace) as `<a>#AI</a><a>#Tech</a>` with no whitespace text node between them, so the rendered tokens visually merged into one underlined run. Margins live outside the link's content area, so the underline ends with each link instead of extending across an injected space.

## 0.0.1

### Patch Changes

- [#3](https://github.com/beatzball/caribou/pull/3) [`becf5d0`](https://github.com/beatzball/caribou/commit/becf5d0c55b79af4915e00f022d7a6073f950bdf) Thanks [@beatzball](https://github.com/beatzball)! - Initial dark-default tokens.css.
