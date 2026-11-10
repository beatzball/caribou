// The server's Bluesky kill switch (README, "Bluesky SSR"). Its own tiny
// module, so a page reads it before it loads `bluesky-public.ts` and the
// atproto SDK: with the switch off, a Bluesky route costs no SDK load.

const OFF = new Set(['0', 'false', 'off', 'no'])

/**
 * True when the server paints Bluesky routes. On unless `BLUESKY_SSR` is
 * `0`, `false`, `off` or `no` (any case, spaces ignored).
 */
export function blueskySsrEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !OFF.has((env.BLUESKY_SSR ?? '').trim().toLowerCase())
}

/** The line the server logs once at start (`server/plugins/bluesky-ssr-log.ts`). */
export function blueskySsrStartupLine(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.BLUESKY_SSR
  const given = raw === undefined ? 'unset' : `BLUESKY_SSR=${JSON.stringify(raw)}`
  return `[caribou] Bluesky SSR is ${blueskySsrEnabled(env) ? 'on' : 'off'} (${given})`
}
