import { createHash } from 'node:crypto'
import { ICONS_HEAD, PAGE_TITLE } from './brand-head.js'

// The page that ends a sign-in. Only `/api/signin/callback` serves it, and
// only after the callback checked this browser's `caribou.signin` cookie and
// exchanged the code: the session rides in the response, never in a URL.
// (An earlier `/signin/done#token=…` page took the session from the URL
// fragment, so anyone could send a reader a link that signed them in to the
// sender's account. That route now only shows the fallback.)

export interface CompletedSession {
  token: string
  server: string
  userKey: string
  vapidKey: string
}

const STYLE = `
    body { font-family: system-ui, sans-serif; padding: 2rem; color: #e4e4e7; background: #0d0d12; }
    a { color: #60a5fa; }
  `

// Reads the session from the JSON block, stores it next to the accounts
// already there, makes it active, and goes on to the app. `replaceState`
// takes the callback URL (with its `code`) out of history first.
const SCRIPT = `
    (function () {
      function showFallback() {
        document.getElementById('status').hidden = true;
        document.getElementById('fallback').hidden = false;
      }
      try {
        var s = JSON.parse(document.getElementById('session').textContent);
        if (!s || !s.token || !s.server || !s.userKey) return showFallback();
        var session = {
          userKey: s.userKey, server: s.server, token: s.token, vapidKey: s.vapidKey || '',
          account: null, createdAt: Date.now(),
        };
        var users = new Map();
        try {
          var existing = JSON.parse(localStorage.getItem('caribou.users') || '[]');
          for (var i = 0; i < existing.length; i++) users.set(existing[i][0], existing[i][1]);
        } catch (e) { /* start fresh */ }
        users.set(s.userKey, session);
        localStorage.setItem('caribou.users', JSON.stringify(Array.from(users.entries())));
        localStorage.setItem('caribou.activeUserKey', JSON.stringify(s.userKey));
        history.replaceState(null, '', '/');
        location.replace('/feed');
      } catch (e) {
        showFallback();
      }
    })();
  `

const sha256 = (text: string): string => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

/**
 * Only the one inline script and style may run. The JSON block is data, not
 * a script, so CSP does not apply to it.
 */
export const COMPLETE_PAGE_CSP = [
  "default-src 'none'",
  `script-src ${sha256(SCRIPT)}`,
  `style-src ${sha256(STYLE)}`,
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

/**
 * JSON for a `<script type="application/json">` block. `<` stops a `</script>`
 * in a value from ending the block; `>`, `&`, U+2028 and U+2029 are escaped
 * too, so the text is safe in any script context.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function page(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Signing in · ${PAGE_TITLE}</title>
  ${ICONS_HEAD}
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>`
}

const FALLBACK = `  <p id="fallback"%HIDDEN%>
    Something went wrong completing sign-in. <a href="/">Return to start</a>.
  </p>`

/** The callback's success response: stores `session` and goes to the app. */
export function completeSigninPage(session: CompletedSession): string {
  const data: CompletedSession = {
    token: session.token, server: session.server, userKey: session.userKey, vapidKey: session.vapidKey,
  }
  return page(`  <p id="status">Signing in…</p>
${FALLBACK.replace('%HIDDEN%', ' hidden')}
  <script type="application/json" id="session">${jsonForScript(data)}</script>
  <script>${SCRIPT}</script>`)
}

/** `/signin/done`: kept for old links, signs nobody in. */
export const SIGNIN_FALLBACK_PAGE = page(FALLBACK.replace('%HIDDEN%', ''))
