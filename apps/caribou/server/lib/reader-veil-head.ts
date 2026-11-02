// The server renders /local, /public, profiles and threads from a fetch
// without the reader's token, so it cannot apply the reader's filters, and
// it cannot know whether a reader is signed in: the accounts live in the
// browser. This head script and style keep a signed-in reader from seeing a
// post their filters would hide before the page has asked their server.
//
// - The script marks `<html>` with `data-caribou-reader-check` when an
//   account is active. The style then sets `--caribou-reader-veil: hidden`
//   on `<html>`; custom properties inherit through shadow roots, and
//   `<caribou-status-card>` hides its post with it (`visibility`), from the
//   first paint, before the app has run. The server HTML stays the same for
//   every reader, so hydration is not touched.
// - Once the app runs, each card sets the property on itself: `visible`
//   when the reader's filters for its post are known, or when they cannot
//   be (signed out, another server's post); a post still being checked
//   stays hidden; one whose check failed is covered by a note with Show and
//   Retry (`components/caribou-status-card.ts`).
// - The mark never comes off by itself: a post is shown only once the
//   reader's filters for it are known, or the reader asks. If the app has
//   not started after 15 s (a slow or failed download), the page says so at
//   the bottom, with Reload, and the posts stay hidden. `app-main.ts`
//   cancels that timer and removes the message when it starts.
// - Without JavaScript nothing runs and nothing is hidden; no reader is
//   signed in without JavaScript.
//
// Plain ES5 in one string, like `root-forward-head.ts`.
const SCRIPT = `(function(){try{
var k=JSON.parse(localStorage.getItem('caribou.activeUserKey')||'null');
if(typeof k!=='string'||k.indexOf('@')<1)return;
var r=document.documentElement;r.setAttribute('data-caribou-reader-check','');
window.__caribouReaderVeil=setTimeout(function(){if(!document.body)return;
var p=document.createElement('p');p.id='caribou-reader-stalled';p.setAttribute('role','status');
p.innerHTML='Posts are hidden until Caribou has checked them against your filters, and it has not started yet. <a href="">Reload</a>';
document.body.appendChild(p);},15000);
}catch(e){}})();`

const STYLE = 'html[data-caribou-reader-check]{--caribou-reader-veil:hidden}'
  + '#caribou-reader-stalled{position:fixed;inset:auto 1rem 1rem 1rem;z-index:200;margin:0;padding:.75rem 1rem;'
  + 'background:var(--bg-2);color:var(--fg-0);border:1px solid var(--border);border-radius:.5rem}'
  + '#caribou-reader-stalled a{color:var(--accent)}'

export const READER_VEIL_HEAD = `<style>${STYLE}</style><script>${SCRIPT.replace(/\n/g, '')}</script>`
