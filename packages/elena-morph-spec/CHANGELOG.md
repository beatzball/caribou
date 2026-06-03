# @beatzball/elena-morph-spec

## 0.0.1

### Patch Changes

- [#19](https://github.com/beatzball/caribou/pull/19) [`4fb1e61`](https://github.com/beatzball/caribou/commit/4fb1e61edd8961ad9c1f87f05cc157fa44ed1034) Thanks [@beatzball](https://github.com/beatzball)! - Pin morph behavior on empty native `<ul>` template parents — documents that Elena's `morphContent` **does** wipe live `<ul>` children when the host's render template emits the `<ul>` empty. `it.fails`-pinned: the day Elena's morph stops wiping these, the test will fail and Caribou's `<caribou-list-mount>` workaround can be retired. Useful as upstream documentation if/when lifted into `@elenajs/core`.
