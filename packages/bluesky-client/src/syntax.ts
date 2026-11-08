/**
 * The syntax door: the atproto rules for a handle, a DID and a record key.
 * The server checks a route with them before it fetches anything (app
 * README, "Bluesky SSR"). A runtime `@atproto` import, so it is a door like
 * `./moderation`: the server imports it; the client never does.
 */
export { isValidDid, isValidHandle, isValidRecordKey } from '@atproto/syntax'
