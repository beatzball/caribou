---
"caribou-app": minor
---

Posts with a link now show its preview card under the text: the image, the title, a short description and the site name. A wide image (on a link, video or photo card) goes on top, full width; a small one sits beside the text; a card with no image is text only. The whole card is one link that opens in a new tab, named by its title. The image box keeps its size before the file arrives, so the list does not jump. A post with media shows no card, as on Mastodon. Long links in post text and in profile bios are shortened the way Mastodon and elk show them (no `https://www.`, an ellipsis on a long path). The link still goes to the full URL, a screen reader still reads the full URL, and copying the link text still gives the full URL. The server render of `/local` and `/public` includes the card.
