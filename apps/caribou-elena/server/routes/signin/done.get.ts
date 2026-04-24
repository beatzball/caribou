import { defineEventHandler, setResponseHeader } from 'h3'

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Signing in…</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: system-ui, sans-serif; padding: 2rem; color: #e4e4e7; background: #0d0d12; }
    a { color: #60a5fa; }
  </style>
</head>
<body>
  <p id="status">Signing in…</p>
  <p id="fallback" hidden>
    Something went wrong completing sign-in. <a href="/">Return to start</a>.
  </p>
  <script>
    (function () {
      function showFallback() {
        document.getElementById('status').hidden = true;
        document.getElementById('fallback').hidden = false;
      }
      try {
        var raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
        if (!raw) return showFallback();
        var p = new URLSearchParams(raw);
        var token    = p.get('token');
        var server   = p.get('server');
        var userKey  = p.get('userKey');
        var vapidKey = p.get('vapidKey') || '';
        if (!token || !server || !userKey || userKey.split('@').length !== 2) return showFallback();
        var session = {
          userKey: userKey, server: server, token: token, vapidKey: vapidKey,
          account: null, createdAt: Date.now(),
        };
        var users = new Map();
        try {
          var existing = JSON.parse(localStorage.getItem('caribou.users') || '[]');
          for (var i = 0; i < existing.length; i++) users.set(existing[i][0], existing[i][1]);
        } catch (e) { /* start fresh */ }
        users.set(userKey, session);
        localStorage.setItem('caribou.users', JSON.stringify(Array.from(users.entries())));
        localStorage.setItem('caribou.activeUserKey', JSON.stringify(userKey));
        history.replaceState(null, '', '/');
        location.replace('/feed');
      } catch (e) {
        showFallback();
      }
    })();
  </script>
</body>
</html>`

export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  return HTML
})
