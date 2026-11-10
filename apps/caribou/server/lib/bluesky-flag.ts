// The server's Bluesky kill switch (README, "Bluesky SSR"). Its own tiny
// module, so a page reads it before it loads `bluesky-public.ts` and the
// atproto SDK: with the switch off, a Bluesky route costs no SDK load.

/** True when the server paints Bluesky routes: on unless `BLUESKY_SSR=0`. */
export function blueskySsrEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BLUESKY_SSR !== '0'
}
