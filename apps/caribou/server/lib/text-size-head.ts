// An inline script for the head of each HTML page that has the theme script
// (`theme-head.ts`): the app's pages, the 404 page and the sign-in pages
// (`signin-complete-page.ts`). It puts the device's text size on `<html>`
// before the first paint, so a page never shows the wrong size first
// (issue 309). The rules are `textSizeFromStorage` and `applyTextSize` in
// `components/_text-size.ts`; the tests run both on the same cases.
//
// One exception: `/` with an active account. Its forward script
// (`root-forward-head.ts`) ends the document before this script, so it never
// runs there. What `/` then shows is the loading screen, whose font is a
// fixed 16px on purpose (`components/_splash.ts`), and after the time limit
// the stuck page, at the browser's own size.
//
// - The size is per device: it reads `caribou.textSize` and nothing about
//   the accounts.
// - The default step sets no attribute, so the root keeps the browser's size.
// - Everything is in try/catch: blocked storage leaves the default.
// - Without JavaScript nothing runs, and the page is the default size.
// - It changes only `<html>`, which is outside every Lit template, so it does
//   not touch hydration.
//
// Plain ES5 in one string: it runs before the app's modules, in any browser.
// The sign-in completion page allows it by its hash.
import { TEXT_SIZES, DEFAULT_TEXT_SIZE, TEXT_SIZE_ATTR, TEXT_SIZE_KEY } from '../../components/_text-size.js'

// The steps that set the attribute: every one but the default.
const STEPS = JSON.stringify(TEXT_SIZES.filter((s) => s !== DEFAULT_TEXT_SIZE))

const SCRIPT = `(function(){var s=null,a=${STEPS},f=false;
try{s=localStorage.getItem('${TEXT_SIZE_KEY}');}catch(e){s=null;}
for(var i=0;i<a.length;i++){if(a[i]===s)f=true;}
var h=document.documentElement;
if(f)h.setAttribute('${TEXT_SIZE_ATTR}',s);else h.removeAttribute('${TEXT_SIZE_ATTR}');
})();`

/** The script's text, for a page whose CSP allows scripts by hash. */
export const TEXT_SIZE_SCRIPT = SCRIPT.replace(/\n/g, '')

export const TEXT_SIZE_HEAD = `<script>${TEXT_SIZE_SCRIPT}</script>`
