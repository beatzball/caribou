/**
 * The browser door to the atproto libraries. The app loads this module only
 * through a dynamic `import()`, so the libraries land in the `bsky` chunk and
 * a Mastodon page never requests them (spec 12.2). Server code and the
 * server-safe modules (`./index.ts`) never import it.
 *
 * The Bluesky `CaribouClient` and the OAuth session code grow here (#177,
 * #182). Until then it hands the SDK classes to the code that needs them.
 */
export { Agent } from '@atproto/api'
export { BrowserOAuthClient } from '@atproto/oauth-client-browser'
