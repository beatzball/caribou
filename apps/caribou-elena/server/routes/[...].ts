import { defineEventHandler, setResponseHeader, getRequestURL } from 'h3';
import { createPageHandler } from '@beatzball/litro/runtime/create-page-handler.js';
import type { LitroRoute } from '@beatzball/litro';
import { routes, pageModules } from '#litro/page-manifest';
import { TOKENS_HEAD } from '../lib/tokens-head.js';
import { UNO_HEAD } from '../lib/uno-head.js';

function matchRoute(
  pathname: string,
): { route: LitroRoute; params: Record<string, string> } | undefined {
  for (const route of routes) {
    if (route.isCatchAll) return { route, params: {} };

    if (!route.isDynamic) {
      if (pathname === route.path) return { route, params: {} };
      continue;
    }

    // Use named capture groups so param values are automatically mapped to names.
    const regexStr =
      '^' +
      route.path
        .replace(/:([^/]+)\(\.\*\)\*/g, '(?<$1>.+)')
        .replace(/:([^/?]+)\?/g, '(?<$1>[^/]*)?')
        .replace(/:([^/]+)/g, '(?<$1>[^/]+)') +
      '$';

    try {
      const match = pathname.match(new RegExp(regexStr));
      if (match) return { route, params: (match.groups ?? {}) as Record<string, string> };
    } catch {
      // malformed pattern — skip
    }
  }
  return undefined;
}

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname;
  const result = matchRoute(pathname);

  if (!result) {
    setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><title>404</title></head>
<body><h1>404 — Not Found</h1><p>No page matched <code>${pathname}</code>.</p></body>
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
    //   • UNO_HEAD   — UnoCSS-generated utility classes for our pages.
    // Vite extracts both out of the client JS bundle, so without injection
    // the shell would ship zero stylesheet references and first paint
    // would be unstyled. Order matters: tokens before utilities so
    // `var(--…)` is defined when the utility resolves it.
    routeMeta: { head: TOKENS_HEAD + UNO_HEAD },
  });
  return handler(event);
});
