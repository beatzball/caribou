import { defineEventHandler, setResponseHeader, setResponseStatus, getRequestURL } from 'h3';
import { createPageHandler } from '@beatzball/litro/runtime/create-page-handler.js';
import { routes, pageModules } from '#litro/page-manifest';
import { TOKENS_HEAD } from '../lib/tokens-head.js';
import { BASE_HEAD } from '../lib/base-head.js';
import { matchRoute } from '../lib/match-route.js';
import { APP_SCRIPT_URL } from '../lib/app-entry.js';
import { ICONS_HEAD, PAGE_TITLE, brandHead } from '../lib/brand-head.js';
import { resolveOrigin } from '../lib/public-origin.js';

// The path is echoed into the page. A URL pathname is percent-encoded, but
// not every client encodes, so escape it rather than trust that.
const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname;
  const result = matchRoute(routes, pathname);

  if (!result) {
    // A page that says 404 must also answer 404: a crawler, a link checker
    // or a fetch() reads the status, not the heading.
    setResponseStatus(event, 404);
    setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><title>Not found · ${PAGE_TITLE}</title>${ICONS_HEAD}</head>
<body><h1>404 — Not Found</h1><p>No page matched <code>${escapeHtml(pathname)}</code>.</p></body>
</html>`;
  }

  const { route: matched, params } = result;

  // Populate route params (e.g. slug from /blog/:slug) on the event context
  // so pageData fetchers can access them via event.context.params.
  event.context.params = { ...event.context.params, ...params };

  const handler = createPageHandler({
    route: matched,
    pageModule: pageModules[matched.filePath],
    // `routeMeta.head` is appended into every page's <head> by Litro's
    // shell builder. We inline two stylesheets here:
    //   • TOKENS_HEAD — design-token CSS variables (`var(--bg-0)` etc.).
    //     Custom properties inherit through shadow roots, so every
    //     component's `static styles` can use them.
    //   • BASE_HEAD   — document-level rules that no shadow root owns.
    // brandHead adds the icons, the manifest and the link-preview tags.
    routeMeta: { title: PAGE_TITLE, head: TOKENS_HEAD + BASE_HEAD + brandHead(resolveOrigin(event)) },
    appScriptUrl: APP_SCRIPT_URL,
  });
  return handler(event);
});
