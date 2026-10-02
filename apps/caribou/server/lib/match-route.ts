import type { LitroRoute } from '@beatzball/litro'

// Matches an incoming pathname against the Litro page manifest's route table.
// Translates the manifest's path-to-regexp-style patterns
// (e.g. `/@:handle/:statusId`) into a JS RegExp with named capture groups,
// then tries each route in order.
//
// Lives in its own module so the catch-all Nitro handler in
// `server/routes/[...].ts` and the regression tests in
// `__tests__/match-route.test.ts` share one implementation.
export function matchRoute(
  routes: readonly LitroRoute[],
  pathname: string,
): { route: LitroRoute; params: Record<string, string> } | undefined {
  for (const route of routes) {
    if (route.isCatchAll) return { route, params: {} }

    if (!route.isDynamic) {
      if (pathname === route.path) return { route, params: {} }
      continue
    }

    const regexStr =
      '^' +
      route.path
        .replace(/:([^/]+)\(\.\*\)\*/g, '(?<$1>.+)')
        .replace(/:([^/?]+)\?/g, '(?<$1>[^/]*)?')
        .replace(/:([^/]+)/g, '(?<$1>[^/]+)') +
      '$'

    try {
      const match = pathname.match(new RegExp(regexStr))
      if (match) return { route, params: (match.groups ?? {}) as Record<string, string> }
    } catch {
      // malformed pattern — skip
    }
  }
  return undefined
}
