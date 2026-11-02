// An inline script for the head of `/home` only: when `/` has just sent the
// reader here, show the same loading screen `/` showed, so the two look like
// one (issue 142). The screen is in `components/_splash.ts`.
//
// - `/` stores when the forward started (`caribou.splash` in
//   sessionStorage). This script reads it once and removes it, so a reload
//   of `/home` shows no screen. A start time older than the time limit is
//   dropped.
// - The screen is added to `<html>` before the body is parsed, so it is in
//   the first frame. It is outside the page the server rendered, so
//   hydration does not see it.
// - It is removed at the time limit, counted from the start, even when the
//   app never runs. The app removes it sooner (`settleSplash`).
// - Everything is in try/catch: blocked storage shows no screen.
// - Without JavaScript nothing runs.
import { LIMIT_MS, SPLASH_ES5, SPLASH_KEY } from '../../components/_splash.js'

const SCRIPT = `(function(){try{
var s=sessionStorage.getItem(${JSON.stringify(SPLASH_KEY)});if(s===null)return;
sessionStorage.removeItem(${JSON.stringify(SPLASH_KEY)});
var t=Number(s),e=Date.now()-t;if(!(e>=0&&e<${LIMIT_MS}))return;
${SPLASH_ES5}
var d=caribouSplash(t);setTimeout(function(){d.remove();},${LIMIT_MS}-e);
}catch(x){}})();`

export const HOME_SPLASH_HEAD = `<script>${SCRIPT.replace(/\n/g, '')}</script>`
