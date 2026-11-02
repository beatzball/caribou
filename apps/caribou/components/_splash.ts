// The loading screen for `/` → `/home` (issue 142): the logo, a ring that
// creeps while the home timeline loads, and "Loading…". It covers the tab
// from the first frame of the forward until the timeline shows its first
// posts, an error, or the empty notice.
//
// Three places show the same screen, so the forward looks like one screen:
//
// 1. The head script of `/` (`server/lib/root-forward-head.ts`), before it
//    goes to `/home`. It stores the start time in sessionStorage.
// 2. The head script of `/home` (`server/lib/home-splash-head.ts`), when
//    that start time is fresh. It sets the ring's animation back by the
//    time already gone, so the ring goes on where `/` left it.
// 3. `showSplash` below, for a client-side navigation to `/`
//    (`replaceWithHome` in `_root-forward.ts`).
//
// The screen is not part of any page's render, and the server never renders
// it: on `/home` the head script adds it to the document before `<body>`.
// So it cannot break hydration. The timeline (or the sign-in placeholder)
// calls `settleSplash` when it has something to show.
//
// The screen never stays: each place that shows it removes it after
// `LIMIT_MS`. After `WAY_OUT_MS` it shows links to `/home` and to sign in.
// The ring's motion, the fill and the fade are CSS only, so they run with no
// script. With `prefers-reduced-motion` the ring stands still and the screen
// goes at once, with no fade.
//
// Colors: the design tokens when the page has them (`/home`), else the same
// values written out (`/`, whose token styles are never read). A
// `data-theme="light"` on `<html>` gives the light colors.
//
// Without JavaScript nothing shows it.

export const SPLASH_ID = 'caribou-splash'
/** sessionStorage: when the forward from `/` started, in ms since the epoch. */
export const SPLASH_KEY = 'caribou.splash'
/** The links to `/home` and to sign in show after this long. */
export const WAY_OUT_MS = 3000
/** The screen is removed after this long, whatever happens. */
export const LIMIT_MS = 10000
/** The ring fills (0.25 s), then the screen fades (0.3 s). */
export const SETTLE_MS = 600

const CSS = `
#${SPLASH_ID}{--cs-bg:var(--bg-0,#0d0d12);--cs-fg:var(--fg-0,#e4e4e7);--cs-muted:var(--fg-1,#a1a1aa);--cs-accent:var(--accent,#60a5fa);--cs-track:var(--border,#27272a);
position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;margin:0;padding:16px;
background:var(--cs-bg);color:var(--cs-fg);font:16px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
opacity:1;transition:opacity .3s ease .25s}
:root[data-theme="light"] #${SPLASH_ID}{--cs-bg:#fafafa;--cs-fg:#18181b;--cs-muted:#3f3f46;--cs-accent:#2563eb;--cs-track:#d4d4d8}
#${SPLASH_ID}[data-done]{opacity:0;pointer-events:none}
#${SPLASH_ID} .cs-stack{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}
#${SPLASH_ID} .cs-ring{position:relative;width:128px;height:128px}
#${SPLASH_ID} svg{display:block;width:100%;height:100%;transform:rotate(-90deg)}
#${SPLASH_ID} circle{fill:none;stroke-width:5}
#${SPLASH_ID} .cs-track{stroke:var(--cs-track)}
#${SPLASH_ID} .cs-bar{stroke:var(--cs-accent);stroke-linecap:round;stroke-dasharray:100;stroke-dashoffset:100;
animation:cs-creep ${LIMIT_MS}ms cubic-bezier(.15,.7,.3,1) var(--cs-t,0ms) forwards}
#${SPLASH_ID}[data-done] .cs-bar{animation:none;stroke-dashoffset:0;transition:stroke-dashoffset .25s ease}
#${SPLASH_ID} img{position:absolute;inset:24px;width:80px;height:80px;border-radius:50%}
#${SPLASH_ID} p{margin:0}
#${SPLASH_ID} .cs-label{color:var(--cs-muted)}
#${SPLASH_ID} .cs-out{visibility:hidden;animation:cs-show 1ms linear calc(${WAY_OUT_MS}ms + var(--cs-t,0ms)) forwards}
#${SPLASH_ID} a{color:var(--cs-accent)}
@keyframes cs-creep{to{stroke-dashoffset:10}}
@keyframes cs-show{to{visibility:visible}}
@media (prefers-reduced-motion:reduce){#${SPLASH_ID},#${SPLASH_ID}[data-done] .cs-bar{transition:none}#${SPLASH_ID} .cs-bar{animation:none;stroke-dashoffset:75}}
`.replace(/\n/g, '')

/** The screen's content: its own styles, the logo and ring, the live text and the way out. */
export const SPLASH_MARKUP = `<style>${CSS}</style>`
  + '<div class="cs-stack">'
  + '<div class="cs-ring"><svg viewBox="0 0 100 100" aria-hidden="true">'
  + '<circle class="cs-track" cx="50" cy="50" r="46" pathLength="100"></circle>'
  + '<circle class="cs-bar" cx="50" cy="50" r="46" pathLength="100"></circle>'
  + '</svg><img src="/logo.png" alt="Caribou" width="80" height="80"></div>'
  + '<p class="cs-label" role="status">Loading…</p>'
  + '<p class="cs-out"><a href="/home">Open your home timeline</a> · <a href="/?add">Sign in</a></p>'
  + '</div>'

/** What `/` shows when `/home` has not come by the time limit. */
export const STUCK_MARKUP = '<p>Opening your home timeline…</p>'
  + '<p><a href="/home">Open your home timeline</a></p><p><a href="/?add">Sign in</a></p>'

/**
 * The same as `showSplash`, in plain ES5 for the head scripts: a function
 * `caribouSplash(start)` that adds the screen and returns it. It adds it to
 * `<body>`, or to `<html>` while there is no body yet.
 */
export const SPLASH_ES5 = `function caribouSplash(t){
var d=document.getElementById(${JSON.stringify(SPLASH_ID)});if(d)d.remove();
d=document.createElement('div');d.id=${JSON.stringify(SPLASH_ID)};
d.innerHTML=${JSON.stringify(SPLASH_MARKUP).replace(/</g, '\\u003c')};
d.style.setProperty('--cs-t',(t-Date.now())+'ms');
(document.body||document.documentElement).appendChild(d);return d;}`

/**
 * Shows the screen for a client-side forward. `start` is when the forward
 * began; the ring and the way out count from it. One screen at a time.
 */
export function showSplash(start: number = Date.now()): HTMLElement {
  document.getElementById(SPLASH_ID)?.remove()
  const el = document.createElement('div')
  el.id = SPLASH_ID
  el.innerHTML = SPLASH_MARKUP
  el.style.setProperty('--cs-t', `${start - Date.now()}ms`)
  document.body.append(el)
  setTimeout(() => el.remove(), Math.max(0, LIMIT_MS - (Date.now() - start)))
  return el
}

/**
 * The page has something to show: fill the ring, fade, and remove the
 * screen. At once with `prefers-reduced-motion`. Safe to call when no
 * screen is shown, and more than once.
 */
export function settleSplash(): void {
  if (typeof document === 'undefined') return
  const el = document.getElementById(SPLASH_ID)
  if (!el || el.hasAttribute('data-done')) return
  let still = false
  try { still = matchMedia('(prefers-reduced-motion: reduce)').matches } catch { /* no matchMedia */ }
  if (still) {
    el.remove()
    return
  }
  el.setAttribute('data-done', '')
  setTimeout(() => el.remove(), SETTLE_MS)
}
