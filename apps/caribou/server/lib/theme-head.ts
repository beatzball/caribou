// An inline script for the head of every page: it puts the active account's
// theme on `<html>` before the first paint, so a light page never flashes
// dark first (issue 49). The rules are `themeFromStorage` and `resolveTheme`
// in `components/_theme.ts`; the tests run both on the same cases.
//
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
if(typeof k==='string'){var p=k.split('@');
if(p.length===2&&p[0]&&p[1]){var s=JSON.parse(localStorage.getItem('caribou.prefs.'+k)||'null');
if(s&&typeof s==='object'&&!Array.isArray(s)&&(s.theme==='light'||s.theme==='system'))t=s.theme;}}
if(t==='system')t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';
}catch(e){t='dark';}
document.documentElement.setAttribute('data-theme',t);
var m=document.querySelector('meta[name="theme-color"]');
if(m)m.setAttribute('content',t==='light'?'${LIGHT_THEME_COLOR}':'${THEME_COLOR}');
})();`

export const THEME_HEAD = `<script>${SCRIPT.replace(/\n/g, '')}</script>`
