// The loading screen for the forward from `/` to the reader's default
// timeline (`/home`, `/local` or `/public`; issues 142 and 49): the logo, a
// ring that creeps while the timeline loads, and "Loading…". It covers the
// tab from the first frame of the forward until that timeline shows its
// first posts, an error, the empty notice or a placeholder.
//
// Three places show the same screen, so the forward looks like one screen:
//
// 1. The head script of `/` (`server/lib/root-forward-head.ts`), before it
//    leaves. It stores the start time and the target in sessionStorage.
// 2. The head script of the target (`server/lib/timeline-splash-head.ts`),
//    when that entry is fresh and names this page. It sets the ring's
//    animation back by the time already gone, so the ring goes on where `/`
//    left it.
// 3. `showSplash` below, for a client-side navigation to `/`
//    (`replaceWithTimeline` in `_root-forward.ts`).
//
// On the target page:
// - The screen is a child of `<html>`, outside `<body>`. The server never
//   renders it, so hydration does not see it. The body is `inert` while it
//   is up, so keyboard focus cannot reach the page under it; focus is on the
//   screen, and its links are the only stops.
// - Leaving the target (Back, a link, any router move: they all fire
//   `popstate`) removes it at once.
// - The timeline, or the page when it shows no timeline, calls
//   `settleSplash` with its path. Then the body is live again, focus goes to
//   the router's outlet, and the screen fills and fades.
//
// The screen never stays: it is removed `LIMIT_MS` after the start. After
// `WAY_OUT_MS` it shows links to the timeline and to sign in. The ring's
// motion, the fill and the fade are CSS. With `prefers-reduced-motion` the
// ring stands still and the screen goes at once, with no fade.
//
// Colors: the design tokens when the page has them, else the same values
// written out (`/`, whose token styles are never read). `data-theme` on
// `<html>`, which the theme head script sets before this one runs, picks
// light or dark, so `/` and the target show the same colors.
//
// Without JavaScript nothing shows it.

export const SPLASH_ID = 'caribou-splash'
/** sessionStorage: `{"t": start in ms since the epoch, "to": target path}`. */
export const SPLASH_KEY = 'caribou.splash'
/** The pages a forward can go to. */
export const SPLASH_TARGETS = ['/home', '/local', '/public'] as const
/** The links to the timeline and to sign in show after this long. */
export const WAY_OUT_MS = 3000
/** The screen is removed after this long, whatever happens. */
export const LIMIT_MS = 10000
/** The ring fills (0.25 s), then the screen fades (0.3 s). */
export const SETTLE_MS = 600
/** Settled this soon after it showed (a kept list), the screen just goes. */
export const QUICK_MS = 150
/** The live text is set after this, so the region is announced as a change. */
export const LIVE_MS = 50

const CSS = `
#${SPLASH_ID}{--cs-bg:var(--bg-0,#0d0d12);--cs-fg:var(--fg-0,#e4e4e7);--cs-muted:var(--fg-1,#a1a1aa);--cs-accent:var(--accent,#60a5fa);--cs-track:var(--border,#27272a);
position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;margin:0;padding:16px;outline:none;
background:var(--cs-bg);color:var(--cs-fg);font:16px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
opacity:1;transition:opacity .3s ease .25s}
:root[data-theme="light"] #${SPLASH_ID}{--cs-bg:var(--bg-0,#fafafa);--cs-fg:var(--fg-0,#18181b);--cs-muted:var(--fg-1,#3f3f46);--cs-accent:var(--accent,#2563eb);--cs-track:var(--border,#d4d4d8)}
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
#${SPLASH_ID} .cs-label{min-height:1.4em;color:var(--cs-muted)}
#${SPLASH_ID} .cs-out{visibility:hidden;animation:cs-show 1ms linear calc(${WAY_OUT_MS}ms + var(--cs-t,0ms)) forwards}
#${SPLASH_ID} a{color:var(--cs-accent)}
@keyframes cs-creep{to{stroke-dashoffset:10}}
@keyframes cs-show{to{visibility:visible}}
@media (prefers-reduced-motion:reduce){#${SPLASH_ID},#${SPLASH_ID}[data-done] .cs-bar{transition:none}#${SPLASH_ID} .cs-bar{animation:none;stroke-dashoffset:75}}
`.replace(/\n/g, '')

/**
 * The screen's content: its own styles, the logo and ring, an empty live
 * region (its text is set a moment later) and the way out. The timeline
 * link's `href` is set when the screen is shown.
 */
export const SPLASH_MARKUP = `<style>${CSS}</style>`
  + '<div class="cs-stack">'
  + '<div class="cs-ring"><svg viewBox="0 0 100 100" aria-hidden="true">'
  + '<circle class="cs-track" cx="50" cy="50" r="46" pathLength="100"></circle>'
  + '<circle class="cs-bar" cx="50" cy="50" r="46" pathLength="100"></circle>'
  + '</svg><img src="/logo.png" alt="Caribou" width="80" height="80"></div>'
  + '<p class="cs-label" role="status"></p>'
  + '<p class="cs-out"><a class="cs-to" href="/home">Open your timeline</a> · <a href="/?add">Sign in</a></p>'
  + '</div>'

export const LIVE_TEXT = 'Loading…'

/** What `/` shows when the timeline has not come by the time limit. */
export const stuckMarkup = (to: string): string => '<p>Opening your timeline…</p>'
  + `<p><a href="${to}">Open your timeline</a></p><p><a href="/?add">Sign in</a></p>`

const js = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

/**
 * The screen for the head scripts, in plain ES5 (function expressions, so it
 * can sit inside a `try` block):
 *
 * - `caribouSplash(start, to, top)` ends any screen already up, adds a new
 *   one and returns it: to `<html>` when `top` is true or there is no body
 *   yet, else to `<body>`. Following one of its links drops the stored
 *   forward.
 * - `caribouGuard(el, to, ms)` keeps the page under the screen out of reach
 *   and puts `caribouRelease` and `caribouEnd` on the element, which
 *   `settleSplash` calls. See `showSplash` for what it does; the two must
 *   agree, and the tests run both.
 */
export const SPLASH_ES5 = `var caribouSplash=function(t,to,top){
var o=document.getElementById(${js(SPLASH_ID)});
if(o){if(o.caribouEnd)o.caribouEnd();else if(o.parentNode)o.parentNode.removeChild(o);}
var d=document.createElement('div');d.id=${js(SPLASH_ID)};d.tabIndex=-1;
d.setAttribute('data-target',to);d.setAttribute('data-shown',String(Date.now()));
d.innerHTML=${js(SPLASH_MARKUP)};
d.querySelector('.cs-to').setAttribute('href',to);
d.style.setProperty('--cs-t',(t-Date.now())+'ms');
d.addEventListener('click',function(e){var a=e.target;while(a&&a!==d&&a.tagName!=='A')a=a.parentNode;
if(a&&a!==d)try{sessionStorage.removeItem(${js(SPLASH_KEY)});}catch(x){}});
(top||!document.body?document.documentElement:document.body).appendChild(d);
setTimeout(function(){var s=d.querySelector('[role=status]');if(s)s.textContent=${js(LIVE_TEXT)};},${LIVE_MS});
return d;};
var caribouGuard=function(d,to,ms){
var done=false,timer=0,mo=null;
var path=function(){return location.pathname.replace(/\\/+$/,'')||'/';};
var lock=function(){if(done||!document.body||!d.parentNode||d.parentNode===document.body)return;
document.body.inert=true;var a=document.activeElement;if(a!==d&&!d.contains(a))try{d.focus({preventScroll:true});}catch(x){}};
var pop=function(){if(path()!==to)end();};
var release=function(){if(done)return;done=true;clearTimeout(timer);if(mo)mo.disconnect();
window.removeEventListener('popstate',pop);document.removeEventListener('DOMContentLoaded',lock);
var c=document.getElementById(${js(SPLASH_ID)});if(c&&c!==d)return;
if(document.body)document.body.inert=false;
var a=document.activeElement;if(!a||a===document.body||a===d||d.contains(a)){
var w=document.querySelector('litro-outlet');if(w&&w.focus)w.focus({preventScroll:true});}};
var end=function(){if(d.parentNode)d.parentNode.removeChild(d);release();};
d.caribouRelease=release;d.caribouEnd=end;
if(typeof MutationObserver==='function'){mo=new MutationObserver(lock);mo.observe(document.documentElement,{childList:true});}
document.addEventListener('DOMContentLoaded',lock);window.addEventListener('popstate',pop);
timer=setTimeout(end,ms);try{d.focus({preventScroll:true});}catch(x){}lock();};`

interface SplashElement extends HTMLElement {
  caribouRelease?: () => void
  caribouEnd?: () => void
}

const currentPath = () => location.pathname.replace(/\/+$/, '') || '/'

/**
 * Shows the screen for a client-side forward to `to`. `start` is when the
 * forward began; the ring and the way out count from it. The same behavior
 * as `caribouSplash` + `caribouGuard`:
 *
 * - One screen at a time: a screen already up is ended first, with all its
 *   timers and listeners.
 * - The screen is a child of `<html>`; the body is `inert` and focus is on
 *   the screen. (The head script also watches for the body to be parsed,
 *   and locks it then.)
 * - Leaving `to` (any `popstate` to another path) ends it at once; so does
 *   the time limit.
 * - Its release runs once: it stops the timer and the listeners, and gives
 *   the body back only when no newer screen is up. Focus left on the screen
 *   goes to the router's outlet.
 */
export function showSplash(to: string, start: number = Date.now()): HTMLElement {
  const old = document.getElementById(SPLASH_ID) as SplashElement | null
  if (old) {
    if (old.caribouEnd) old.caribouEnd()
    else old.remove()
  }
  const el = document.createElement('div') as SplashElement
  el.id = SPLASH_ID
  el.tabIndex = -1
  el.dataset.target = to
  el.dataset.shown = String(Date.now())
  el.innerHTML = SPLASH_MARKUP
  el.querySelector('.cs-to')!.setAttribute('href', to)
  el.style.setProperty('--cs-t', `${start - Date.now()}ms`)
  el.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest?.('a')) {
      try { sessionStorage.removeItem(SPLASH_KEY) } catch { /* blocked */ }
    }
  })
  document.documentElement.append(el)
  setTimeout(() => {
    const status = el.querySelector('[role="status"]')
    if (status) status.textContent = LIVE_TEXT
  }, LIVE_MS)

  let done = false
  const onPop = () => { if (currentPath() !== to) end() }
  const release = () => {
    if (done) return
    done = true
    clearTimeout(timer)
    window.removeEventListener('popstate', onPop)
    const current = document.getElementById(SPLASH_ID)
    if (current && current !== el) return // a newer screen owns the body
    document.body.inert = false
    const active = document.activeElement
    if (!active || active === document.body || el.contains(active)) {
      document.querySelector<HTMLElement>('litro-outlet')?.focus({ preventScroll: true })
    }
  }
  const end = () => {
    el.remove()
    release()
  }
  el.caribouRelease = release
  el.caribouEnd = end
  document.body.inert = true
  window.addEventListener('popstate', onPop)
  const timer = setTimeout(end, Math.max(0, LIMIT_MS - (Date.now() - start)))
  el.focus({ preventScroll: true })
  return el
}

/**
 * The page at `path` has something to show: the page under the screen is
 * live again, and the screen fills, fades and goes. It goes at once with
 * `prefers-reduced-motion`, or when it showed only a moment ago (a kept
 * list was there at once). Does nothing when no screen is up for `path`,
 * and is safe to call more than once.
 */
export function settleSplash(path: string): void {
  if (typeof document === 'undefined') return
  const el = document.getElementById(SPLASH_ID) as SplashElement | null
  if (!el || el.hasAttribute('data-done') || el.dataset.target !== path) return
  el.caribouRelease?.()
  const end = () => (el.caribouEnd ? el.caribouEnd() : el.remove())
  let still = false
  try { still = matchMedia('(prefers-reduced-motion: reduce)').matches } catch { /* no matchMedia */ }
  if (still || Date.now() - Number(el.dataset.shown) < QUICK_MS) {
    end()
    return
  }
  el.setAttribute('data-done', '')
  setTimeout(end, SETTLE_MS)
}
