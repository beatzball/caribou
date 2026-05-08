# @beatzball/caribou-design-tokens

## 0.1.0

### Minor Changes

- [#17](https://github.com/beatzball/caribou/pull/17) [`b371f8d`](https://github.com/beatzball/caribou/commit/b371f8d14fab3d956a884fa36d469fe6bbd79478) Thanks [@beatzball](https://github.com/beatzball)! - Add `presetCaribou()` UnoCSS preset. Maps Caribou's design-token CSS
  variables (`--bg-0/1/2`, `--fg-0/1/muted`, `--accent`, `--accent-fg`,
  `--border`, `--danger`, `--success`, `--radius-sm/md/lg`, `--space-1..6`)
  to atomic utility classes consumable by app shells via
  `presetUno() + presetCaribou()`.

### Patch Changes

- [`fcf5578`](https://github.com/beatzball/caribou/commit/fcf55789c822188b79d31f20da1ca26ba66cd01d) Thanks [@beatzball](https://github.com/beatzball)! - Drop the `.status-content` wrap and adjacent-link rules from `tokens.css`.

  These selectors only ever needed to reach inside `caribou-status-card`'s rendered post HTML. Now that the card uses shadow DOM (see `caribou-elena` patch), global CSS no longer crosses into its rendered tree — keeping the rules in the global tokens stylesheet would silently apply to nothing. The card adopts its own copy of the rules onto its shadow root via Elena's `static styles`.

- [`8b4d3e1`](https://github.com/beatzball/caribou/commit/8b4d3e100088c798ab6a94bf36421c4b2d06197c) Thanks [@beatzball](https://github.com/beatzball)! - Add `.status-content` rules to `tokens.css` so sanitized post HTML wraps and adjacent links separate visually.
  - `overflow-wrap: anywhere; word-break: break-word; min-width: 0` on `.status-content`, `.status-content > p`, and `.status-content a`. Long unbreakable runs (stacks of hashtag/mention `<a>` links, raw URLs) were pushing the timeline off-screen on narrow viewports; `overflow-wrap` on the parent alone wasn't enough because the actual line boxes live on the `<p>`/`<a>` descendants emitted by Mastodon.
  - `margin-inline-start: 0.25em` on `.status-content a + a`. Mastodon emits author-typed `#AI#Tech` (no source whitespace) as `<a>#AI</a><a>#Tech</a>` with no whitespace text node between them, so the rendered tokens visually merged into one underlined run. Margins live outside the link's content area, so the underline ends with each link instead of extending across an injected space.

## 0.0.1

### Patch Changes

- [#3](https://github.com/beatzball/caribou/pull/3) [`becf5d0`](https://github.com/beatzball/caribou/commit/becf5d0c55b79af4915e00f022d7a6073f950bdf) Thanks [@beatzball](https://github.com/beatzball)! - Initial dark-default tokens.css.
