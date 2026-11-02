// An inline script for the head of `/` only: when an account is active, go
// to its default timeline (`/home`, or `/local` or `/public` as chosen on
// /settings) before the first paint, so the sign-in form does not flash
// (issue 135). The rules are `rootForwardTarget` in
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
// - The theme head script runs before this one on `/` (`[...].ts`), so the
//   screen has the reader's colors; it would be hidden text otherwise.
// - It stores the start time and the target (`caribou.splash` in
//   sessionStorage), so the timeline shows the same screen and its ring
//   goes on from there.
// - The screen shows links to the timeline and to sign in after 3 s. When
//   the timeline has not come by the time limit (a slow server, or the
//   reader stopped the load), the screen gives way to a plain page with the
//   same links, and the stored forward is dropped. The tab is never a dead
//   end.
// - When it stays, it marks `<html>` with `data-caribou-root`. That tells the
//   page (`pages/index.ts`) that this load is decided: the router must not
//   check again, as the error banner may have consumed a stashed error by
//   then.
// - `pageshow` with `persisted`: a page back from the back-forward cache did
//   not run this script again, so it checks again then, but only when the
//   page is still on `/` (the reader may have moved on with client-side
//   navigation). That page is already parsed and painted: no
//   `document.write` (it would wipe the page). Its screen is a child of
//   `<html>` with the same guard as on the timeline (`caribouGuard`): the
//   landing under it is inert, and at the time limit the screen goes and
//   the landing is live again. A `/` that was already ended as hidden text
//   (a forward stopped, then restored) shows the plain page at the limit.
// - Everything is in try/catch: blocked storage leaves `/` as it is.
// - Without JavaScript nothing runs, and `/` stays the sign-in page.
//
// Plain ES5 in one string: it runs before the app's modules, in any browser.
// The pages send no Content-Security-Policy, so an inline script may run.
import { LIMIT_MS, SPLASH_ES5, SPLASH_KEY, stuckMarkup } from '../../components/_splash.js'

const SCRIPT = `(function(){
function timeline(k){try{var s=JSON.parse(localStorage.getItem('caribou.prefs.'+k)||'null');
var t=s&&typeof s==='object'&&!Array.isArray(s)?s.defaultTimeline:null;
if(t==='local'||t==='public')return '/'+t;}catch(e){}
return '/home';}
function target(){
var q=new URLSearchParams(location.search);
if(q.has('add')||q.has('error')||sessionStorage.getItem('caribou.error'))return null;
var k=JSON.parse(localStorage.getItem('caribou.activeUserKey')||'null');
var u=JSON.parse(localStorage.getItem('caribou.users')||'[]');
if(typeof k!=='string'||!Array.isArray(u))return null;
var p=k.split('@');if(p.length!==2||!p[0]||!p[1])return null;
for(var i=0;i<u.length;i++){if(Array.isArray(u[i])&&u[i][0]===k)return timeline(k);}
return null;}
${SPLASH_ES5}
function show(to){
var t=Date.now();
try{sessionStorage.setItem(${JSON.stringify(SPLASH_KEY)},JSON.stringify({t:t,to:to}));}catch(e){}
if(document.readyState==='loading')document.write('<plaintext hidden>');
var b=document.body,cut=!!(b&&b.firstElementChild&&b.firstElementChild.tagName==='PLAINTEXT');
var d=caribouSplash(t,to,!cut);
if(!cut)caribouGuard(d,'/',${LIMIT_MS});
setTimeout(function(){
try{sessionStorage.removeItem(${JSON.stringify(SPLASH_KEY)});}catch(e){}
if(cut&&document.body)document.body.innerHTML=${JSON.stringify(stuckMarkup('@TO@')).replace(/</g, '\\u003c').replace('@TO@', '"+to+"')};},${LIMIT_MS});}
function leave(to){
var n=false;function go(){if(n)return;n=true;location.replace(to);}
try{show(to);}catch(e){}
requestAnimationFrame(function(){setTimeout(go,0);});setTimeout(go,100);}
function check(){var to=null;try{to=target();}catch(e){}
if(to)leave(to);
return !!to;}
if(!check())document.documentElement.setAttribute('data-caribou-root','');
window.addEventListener('pageshow',function(e){if(e.persisted&&location.pathname==='/')check();});
})();`

export const ROOT_FORWARD_HEAD = `<script>${SCRIPT.replace(/\n/g, '')}</script>`
