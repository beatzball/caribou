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
// - If the app never runs (a script error, a failed chunk), the mark comes
//   off after 15 s, so the page is not left blank. `app-main.ts` cancels
//   that timer when it starts: from then on the cards decide.
// - Without JavaScript nothing runs and nothing is hidden; no reader is
//   signed in without JavaScript.
//
// Plain ES5 in one string, like `root-forward-head.ts`.
const SCRIPT = `(function(){try{
var k=JSON.parse(localStorage.getItem('caribou.activeUserKey')||'null');
if(typeof k!=='string'||k.indexOf('@')<1)return;
var r=document.documentElement;r.setAttribute('data-caribou-reader-check','');
window.__caribouReaderVeil=setTimeout(function(){r.removeAttribute('data-caribou-reader-check');},15000);
}catch(e){}})();`

const STYLE = 'html[data-caribou-reader-check]{--caribou-reader-veil:hidden}'

export const READER_VEIL_HEAD = `<style>${STYLE}</style><script>${SCRIPT.replace(/\n/g, '')}</script>`
