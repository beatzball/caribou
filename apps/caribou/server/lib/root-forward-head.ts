// An inline script for the head of `/` only: when an account is active, go
// to `/home` before the first paint, so the sign-in form does not flash
// (issue 135). The rules are `forwardsToHome` in
// `components/_root-forward.ts`; the tests run both on the same cases.
//
// - `location.replace`, so `/` leaves no history entry and Back does not loop.
// - The page is hidden while `/home` loads. If that load never commits (a
//   stopped load, a network error), the page shows again after 3 s.
// - `pageshow` with `persisted`: a `/` page back from the back-forward cache
//   did not run this script again, so it checks again then.
// - Everything is in try/catch: blocked storage leaves `/` as it is.
// - Without JavaScript nothing runs, and `/` stays the sign-in page.
//
// Plain ES5 in one string: it runs before the app's modules, in any browser.
// The pages send no Content-Security-Policy, so an inline script may run.
const SCRIPT = `(function(){
function go(){try{
var q=new URLSearchParams(location.search);
if(q.has('add')||q.has('error')||sessionStorage.getItem('caribou.error'))return;
var k=JSON.parse(localStorage.getItem('caribou.activeUserKey')||'null');
var u=JSON.parse(localStorage.getItem('caribou.users')||'[]');
if(typeof k!=='string'||k.split('@').length!==2||!Array.isArray(u))return;
for(var i=0;i<u.length;i++){if(Array.isArray(u[i])&&u[i][0]===k){
var r=document.documentElement;
r.setAttribute('data-caribou-forward','');r.style.visibility='hidden';
setTimeout(function(){r.removeAttribute('data-caribou-forward');r.style.visibility='';},3000);
location.replace('/home');return;}}
}catch(e){}}
go();
window.addEventListener('pageshow',function(e){if(e.persisted)go();});
})();`

export const ROOT_FORWARD_HEAD = `<script>${SCRIPT.replace(/\n/g, '')}</script>`
