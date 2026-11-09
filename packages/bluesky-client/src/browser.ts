/**
 * The browser door to the atproto libraries. The app loads this module only
 * through a dynamic `import()`, so the libraries land in the `bsky` chunk and
 * a Mastodon page never requests them (spec 12.2). Server code and the
 * server-safe modules (`./index.ts`) never import it.
 */
export { Agent } from '@atproto/api'
export { BrowserOAuthClient } from '@atproto/oauth-client-browser'
export * from './client.js'
export * from './errors.js'
export * from './oauth.js'
export * from './compose.js'
