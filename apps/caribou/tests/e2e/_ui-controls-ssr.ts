// What Lit SSR sends for `<caribou-button type="submit">Post</caribou-button>`,
// stylesheet left out (it sits outside Lit's template markers and plays no
// part in hydration). `ui-controls-hydration.spec.ts` hydrates it in a real
// browser; `tests/integration/ssr-ui-controls.test.ts` fails if the server
// render stops matching it, so this copy cannot go stale.
export const SSR_SUBMIT_BUTTON = '<caribou-button  type="submit" variant="secondary"><template shadowroot="open" shadowrootmode="open" shadowrootdelegatesfocus><!--lit-part 9Is3vDlH8Ss=--><!--lit-node 0--><button type="button" part="button" data-variant="secondary"\n      \n      \n      ><!--lit-part--><!--/lit-part--><slot></slot></button><!--/lit-part--></template>Post</caribou-button>'
