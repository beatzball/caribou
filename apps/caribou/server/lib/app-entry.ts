// The URL the page loads the client entry from.
//
// `/_litro/app.js` has the same name in every build, so a browser that kept
// an old copy keeps loading the old app after a deploy, and that app asks
// for hashed chunks the new image no longer has. The query string changes
// with the entry's content, so each deploy's HTML names a URL that no
// browser has cached yet. See `nitro.config.ts` for where the version comes
// from.
//
// Unset when no client build exists (unit tests, a fresh clone): Litro then
// uses the bare `/_litro/app.js`. Under `litro dev` it can be the hash of a
// leftover `dist/client/app.js`; that does no harm, because the dev live
// entry takes no `appScriptUrl`, and without it the bare file is served
// `no-cache` either way.
declare const __CARIBOU_APP_ENTRY_VERSION__: string | undefined

export const APP_SCRIPT_URL: string | undefined =
  typeof __CARIBOU_APP_ENTRY_VERSION__ === 'string'
    ? `/_litro/app.js?v=${__CARIBOU_APP_ENTRY_VERSION__}`
    : undefined
