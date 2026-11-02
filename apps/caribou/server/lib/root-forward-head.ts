// An inline script for the head of `/` only: when an account is active, go
// to `/home` before the first paint, so the sign-in form does not flash
// (issue 135). The rules are `forwardsToHome` in
// `components/_root-forward.ts`; the tests run both on the same cases.
//
// - `location.replace`, so `/` leaves no history entry and Back does not loop.
// - It shows the loading screen first (`components/_splash.ts`, issue 142).
//   A browser does not paint a page whose parser a navigation stopped in
//   the head (Chromium never does, not even a body added later). So the
//   script ends the page itself: `document.write('<plaintext hidden>')`
//   turns the rest of `/` into hidden text. The landing and the app are
//   never parsed as markup, nothing in them runs, and the page is complete
//   at once. The screen paints, and `location.replace` runs after one frame
//   (or 100 ms, as a tab in the background has no frames).
// - It stores the start time (`caribou.splash` in sessionStorage), so
//   `/home` shows the same screen and its ring goes on from there.
// - The screen shows links to `/home` and to sign in after 3 s. When
//   `/home` has not come by the time limit (a slow server, or the reader
//   stopped the load), the screen gives way to a plain page with the same
//   links, so the tab is never a dead end.
// - When it stays, it marks `<html>` with `data-caribou-root`. That tells the
//   page (`pages/index.ts`) that this load is decided: the router must not
//   check again, as the error banner may have consumed a stashed error by
//   then.
// - `pageshow` with `persisted`: a page back from the back-forward cache did
//   not run this script again, so it checks again then, but only when the
//   page is still on `/` (the reader may have moved on with client-side
//   navigation). That page is already parsed and painted: no
//   `document.write` (it would wipe the page), and at the time limit the
//   screen only goes away.
// - Everything is in try/catch: blocked storage leaves `/` as it is.
// - Without JavaScript nothing runs, and `/` stays the sign-in page.
//
// Plain ES5 in one string: it runs before the app's modules, in any browser.
// The pages send no Content-Security-Policy, so an inline script may run.
import { LIMIT_MS, SPLASH_ES5, SPLASH_KEY, STUCK_MARKUP } from '../../components/_splash.js'

const SCRIPT = `(function(){
function signedIn(){
var q=new URLSearchParams(location.search);
if(q.has('add')||q.has('error')||sessionStorage.getItem('caribou.error'))return false;
var k=JSON.parse(localStorage.getItem('caribou.activeUserKey')||'null');
var u=JSON.parse(localStorage.getItem('caribou.users')||'[]');
if(typeof k!=='string'||!Array.isArray(u))return false;
var p=k.split('@');if(p.length!==2||!p[0]||!p[1])return false;
for(var i=0;i<u.length;i++){if(Array.isArray(u[i])&&u[i][0]===k)return true;}
return false;}
${SPLASH_ES5}
function leave(){
var n=false;function go(){if(n)return;n=true;location.replace('/home');}
try{show();}catch(e){}
requestAnimationFrame(function(){setTimeout(go,0);});setTimeout(go,100);}
function show(){
var t=Date.now(),cut=document.readyState==='loading';
try{sessionStorage.setItem(${JSON.stringify(SPLASH_KEY)},String(t));}catch(e){}
if(cut)document.write('<plaintext hidden>');
var d=caribouSplash(t);
setTimeout(function(){if(!d.parentNode)return;
if(cut){d.parentNode.innerHTML=${JSON.stringify(STUCK_MARKUP).replace(/</g, '\\u003c')};}else{d.remove();}},${LIMIT_MS});}
function check(){var f=false;try{f=signedIn();}catch(e){}
if(f)leave();
return f;}
if(!check())document.documentElement.setAttribute('data-caribou-root','');
window.addEventListener('pageshow',function(e){if(e.persisted&&location.pathname==='/')check();});
})();`

export const ROOT_FORWARD_HEAD = `<script>${SCRIPT.replace(/\n/g, '')}</script>`
