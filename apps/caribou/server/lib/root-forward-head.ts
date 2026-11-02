// An inline script for the head of `/` only: when an account is active, go
// to its default timeline (`/home`, or `/local` or `/public` as chosen on
// /settings) before the first paint, so the sign-in form does not flash
// (issue 135). The rules are `rootForwardTarget` in
// `components/_root-forward.ts`; the tests run both on the same cases.
//
// - `location.replace`, so `/` leaves no history entry and Back does not loop.
// - The browser stops parsing `/` when that navigation starts. Nothing below
//   this script is read: no landing, no app. Until the timeline commits the tab is
//   empty. When it has not committed after 3 s (a slow server, or the reader
//   stopped the load), the script writes a small body with links to the timeline
//   and to sign in, so the tab is never a dead end.
// - When it stays, it marks `<html>` with `data-caribou-root`. That tells the
//   page (`pages/index.ts`) that this load is decided: the router must not
//   check again, as the error banner may have consumed a stashed error by
//   then.
// - `pageshow` with `persisted`: a page back from the back-forward cache did
//   not run this script again, so it checks again then, but only when the
//   page is still on `/` (the reader may have moved on with client-side
//   navigation).
// - Everything is in try/catch: blocked storage leaves `/` as it is.
// - Without JavaScript nothing runs, and `/` stays the sign-in page.
//
// Plain ES5 in one string: it runs before the app's modules, in any browser.
// The pages send no Content-Security-Policy, so an inline script may run.
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
function stuck(to){if(document.body)return;
var b=document.createElement('body');
b.innerHTML='<p>Opening your timeline\\u2026</p><p><a href="'+to+'">Open your timeline</a></p><p><a href="/?add">Sign in</a></p>';
document.documentElement.appendChild(b);}
function go(){var to=null;try{to=target();}catch(e){}
if(to){setTimeout(function(){stuck(to);},3000);location.replace(to);}
return !!to;}
if(!go())document.documentElement.setAttribute('data-caribou-root','');
window.addEventListener('pageshow',function(e){if(e.persisted&&location.pathname==='/')go();});
})();`

export const ROOT_FORWARD_HEAD = `<script>${SCRIPT.replace(/\n/g, '')}</script>`
