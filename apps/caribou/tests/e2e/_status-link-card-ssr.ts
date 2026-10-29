// A link preview card as the server renders it, and the card it was rendered
// from. `status-link-card-hydration.spec.ts` hydrates it in a real browser;
// `tests/integration/ssr-status-link-card.test.ts` fails if the server render
// stops matching it, so this copy cannot go stale. Stylesheets are left out,
// as in `_status-card-ssr.ts`.
export const SSR_LINK_CARD = {
  url: 'https://news.example/story', title: 'A story', description: 'What happened today.',
  type: 'link', blurhash: '', authors: [], embedUrl: '',
  providerName: 'Example News', authorName: null,
  image: 'https://files.example.social/card.png', imageDescription: 'A chart',
  width: 1200, height: 600, html: null,
}

export const SSR_STATUS_LINK_CARD = String.raw`<caribou-status-link-card ><template shadowroot="open" shadowrootmode="open"><!--lit-part uT7q81/2cXo=-->
      <!--lit-node 0--><a href="https://news.example/story" target="_blank" rel="noopener noreferrer" data-layout="large"
        aria-labelledby="title" aria-describedby="details">
        <!--lit-part jtby1oTaaQ4=-->
          <!--lit-node 0--><div class="image" style="--ar: 2">
            <!--lit-node 1--><img src="https://files.example.social/card.png" alt="A chart" loading="lazy" decoding="async" />
          </div>
        <!--/lit-part-->
        <div class="text">
          <span class="title" id="title"><!--lit-part-->A story<!--/lit-part--></span>
          <span class="details" id="details">
            <!--lit-part kuZohChXnHk=--><span class="description"><!--lit-part-->What happened today.<!--/lit-part--></span><!--/lit-part-->
            <span class="byline"><!--lit-part-->Example News<!--/lit-part--></span>
          </span>
        </div>
      </a>
    <!--/lit-part--></template></caribou-status-link-card>`
