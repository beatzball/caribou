---
'caribou-app': patch
---

A mention in a post now opens Caribou's own profile page for that account, without a full page load. The post HTML is unchanged, so without JavaScript, or with a modifier key or middle click, the link still goes to the account's instance. Hashtags and other links keep their old behaviour.

Links in a post that open in a new tab now always carry `rel="noopener noreferrer"`, on the server and in the browser, even when the author's server left it out.
