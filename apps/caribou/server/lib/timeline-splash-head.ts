// An inline script for the head of `/home`, `/local` and `/public`: when `/`
// has just sent the reader here, show the same loading screen `/` showed, so
// the two look like one (issues 142 and 49). The screen is in
// `components/_splash.ts`.
//
// - `/` stores the start time and the target (`caribou.splash` in
//   sessionStorage). This script reads it once and removes it, so a reload
//   shows no screen. It shows the screen only when the target is this page
//   and the start is within the time limit.
// - The screen is added to `<html>` before the body is parsed, so it is in
//   the first frame. It is outside the page the server rendered, so
//   hydration does not see it. `caribouGuard` makes the body inert, removes
//   the screen when the reader leaves this page, and at the time limit, even
//   when the app never runs. The app removes it sooner (`settleSplash`).
// - Everything is in try/catch: blocked storage shows no screen.
// - Without JavaScript nothing runs.
//
// Plain ES5 in one string: it runs before the app's modules, in any browser.
import { LIMIT_MS, SPLASH_ES5, SPLASH_KEY } from '../../components/_splash.js'

const SCRIPT = `(function(){try{
var s=sessionStorage.getItem(${JSON.stringify(SPLASH_KEY)});if(s===null)return;
sessionStorage.removeItem(${JSON.stringify(SPLASH_KEY)});
var f=JSON.parse(s),here=location.pathname.replace(/\\/+$/,'')||'/';
if(!f||typeof f.t!=='number'||f.to!==here)return;
var e=Date.now()-f.t;if(!(e>=0&&e<${LIMIT_MS}))return;
${SPLASH_ES5}
caribouGuard(caribouSplash(f.t,here),here,${LIMIT_MS}-e);
}catch(x){}})();`

export const TIMELINE_SPLASH_HEAD = `<script>${SCRIPT.replace(/\n/g, '')}</script>`
