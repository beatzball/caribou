// The server side of the Bluesky flag (README, "Bluesky SSR"). Its own tiny
// module, so a page reads it before it loads `bluesky-public.ts` and the
// atproto SDK: with the flag off, a Bluesky route costs no SDK load.

/** True when the server paints Bluesky routes: `BLUESKY_SSR=1`. */
export function blueskySsrEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BLUESKY_SSR === '1'
}
