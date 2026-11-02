// An inline script for the head of every HTML page — the app's pages, the
// 404 page and the sign-in pages (`signin-complete-page.ts`): it puts the active account's
// theme on `<html>` before the first paint, so a light page never flashes
// dark first (issue 49). The rules are `themeFromStorage` and `resolveTheme`
// in `components/_theme.ts`; the tests run both on the same cases.
//
// - Like `loadFromStorage`, it trusts the active key only when that account
//   is in `caribou.users`; otherwise the app would flip to dark after load.
// - It sits after the brand tags, so the theme-color meta is already parsed
//   and can follow the theme.
// - Everything is in try/catch: blocked storage or bad JSON leaves the dark
//   default, which tokens.css gives `:root` anyway.
// - Without JavaScript nothing runs, and the page is dark.
// - It changes only `<html>`, which is outside every Lit template, so it does
//   not touch hydration.
//
// Plain ES5 in one string: it runs before the app's modules, in any browser.
// The pages send no Content-Security-Policy, so an inline script may run.
import { LIGHT_THEME_COLOR, THEME_COLOR } from './brand-head.js'

const SCRIPT = `(function(){var t='dark';
try{var k=JSON.parse(localStorage.getItem('caribou.activeUserKey')||'null');
var u=JSON.parse(localStorage.getItem('caribou.users')||'[]');var f=false;
if(typeof k==='string'&&Array.isArray(u)){var p=k.split('@');
if(p.length===2&&p[0]&&p[1])for(var i=0;i<u.length;i++){if(Array.isArray(u[i])&&u[i][0]===k)f=true;}}
if(f){var s=JSON.parse(localStorage.getItem('caribou.prefs.'+k)||'null');
if(s&&typeof s==='object'&&!Array.isArray(s)&&(s.theme==='light'||s.theme==='system'))t=s.theme;}
if(t==='system')t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';
}catch(e){t='dark';}
document.documentElement.setAttribute('data-theme',t);
var m=document.querySelector('meta[name="theme-color"]');
if(m)m.setAttribute('content',t==='light'?'${LIGHT_THEME_COLOR}':'${THEME_COLOR}');
})();`

/** The script's text, for a page whose CSP allows scripts by hash. */
export const THEME_SCRIPT = SCRIPT.replace(/\n/g, '')

export const THEME_HEAD = `<script>${THEME_SCRIPT}</script>`
