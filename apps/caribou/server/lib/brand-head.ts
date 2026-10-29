// The app's name, icons and link-preview tags, for every page's <head>.
//
// The files named here live in `public/` and are made from
// `assets-src/caribou-logo.png` by `scripts/build-icons.mjs`.

export const APP_NAME = 'Caribou'

// The page background, `--bg-0` in packages/design-tokens/tokens.css. The
// app has one theme today (the dark one), so there is one theme colour.
// `public/site.webmanifest` repeats it; a test checks that all three agree.
export const THEME_COLOR = '#0d0d12'

// The router does not change document.title on client-side navigation, so
// a page title such as "Home · Caribou" would stay on the tab after the
// reader moves to another page. Every page has the one title.
export const PAGE_TITLE = APP_NAME

const escapeAttr = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

// For every HTML response, including the 404 page and sign-in's done page.
export const ICONS_HEAD = [
  '<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />',
  '<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
  `<meta name="theme-color" content="${THEME_COLOR}" />`,
].join('')

// For the app's pages. A link preview fetches og:image on its own, without
// the page, so the URL must be absolute; `origin` is `resolveOrigin(event)`.
export function brandHead(origin: string): string {
  const image = escapeAttr(`${origin}/og-image.png`)
  return ICONS_HEAD + [
    '<link rel="manifest" href="/site.webmanifest" />',
    `<meta name="application-name" content="${APP_NAME}" />`,
    `<meta name="apple-mobile-web-app-title" content="${APP_NAME}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${APP_NAME}" />`,
    `<meta property="og:title" content="${APP_NAME}" />`,
    `<meta property="og:image" content="${image}" />`,
    '<meta property="og:image:width" content="512" />',
    '<meta property="og:image:height" content="512" />',
    `<meta property="og:image:alt" content="The ${APP_NAME} logo" />`,
    '<meta name="twitter:card" content="summary" />',
  ].join('')
}
