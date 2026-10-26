import { defineNitroConfig } from 'nitropack/config';
import type { Nitro } from 'nitropack';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ssrPreset, ssgPreset } from '@beatzball/litro/config';
import pagesPlugin from '@beatzball/litro/plugins';
import ssgPlugin from '@beatzball/litro/plugins/ssg';

// LITRO_MODE controls the deployment target at build time:
//   LITRO_MODE=server  litro build     (default — Node.js server)
//   LITRO_MODE=static  litro generate  (SSG — static HTML for CDN)
const mode = process.env.LITRO_MODE ?? 'server';

// Version of the client entry, for `server/lib/app-entry.ts`. `litro build`
// runs `vite build` before Nitro loads this file, so `dist/client/app.js` is
// already the file this image will serve. Hashing it (rather than using
// GIT_SHA, which can be 'unknown' in a build without .git) gives the same
// value on the server and in the asset, and a new value whenever any chunk
// changes: the entry names app-main by its hash, whose content names every
// other chunk by theirs.
const appEntry = resolve('dist/client/app.js');
const appEntryVersion = existsSync(appEntry)
  ? createHash('sha256').update(readFileSync(appEntry)).digest('hex').slice(0, 12)
  : undefined;

export default defineNitroConfig({
  ...(mode === 'static' ? ssgPreset() : ssrPreset()),

  srcDir: 'server',

  publicAssets: [
    { dir: '../dist/client', baseURL: '/_litro/', maxAge: 31536000 },
    { dir: '../public',      baseURL: '/',        maxAge: 0 },
  ],

  // Must be bundled for edge runtimes (Cloudflare Workers, Vercel Edge).
  externals: { inline: ['@lit-labs/ssr', '@lit-labs/ssr-client'] },

  // Lit uses legacy experimental decorators.
  esbuild: {
    options: {
      tsconfigRaw: {
        compilerOptions: {
          experimentalDecorators: true,
          useDefineForClassFields: false,
        },
      },
    },
  },

  ignore: ['**/middleware/vite-dev.ts'],
  handlers: [
    {
      middleware: true,
      handler: resolve('./server/middleware/vite-dev.ts'),
      env: 'dev',
    },
  ],

  hooks: {
    'build:before': async (nitro: Nitro) => {
      await pagesPlugin(nitro);
      await ssgPlugin(nitro);
    },
  },

  compatibilityDate: '2025-01-01',

  replace: appEntryVersion
    ? { __CARIBOU_APP_ENTRY_VERSION__: JSON.stringify(appEntryVersion) }
    : {},

  // Everything Vite writes under assets/ has a content hash in its name, so
  // it can be cached for good. The entry, app.js, does not: it must be
  // revalidated (ETag, a 304 when unchanged) or a browser keeps an old app
  // after a deploy. The more specific rule wins over '/_litro/**', and the
  // query string of the versioned URL does not take part in the match.
  routeRules: {
    '/_litro/**': {
      headers: { 'cache-control': 'public, max-age=31536000, immutable' },
    },
    '/_litro/app.js': {
      headers: { 'cache-control': 'no-cache' },
    },
  },
});
