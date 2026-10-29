// A post's media as the server renders it, and the attachments it was
// rendered from. `status-media-hydration.spec.ts` hydrates it in a real
// browser; `tests/integration/ssr-status-media.test.ts` fails if the server
// render stops matching it, so this copy cannot go stale. Stylesheets are
// left out, as in `_status-card-ssr.ts`.
export const SSR_MEDIA = [
  { id: 'm1', type: 'image', url: 'https://files.example.social/m1.png', previewUrl: 'https://files.example.social/m1-small.png',
    description: 'A red fox in the snow', meta: { small: { width: 400, height: 300, size: '400x300', aspect: 4 / 3 } } },
  { id: 'm2', type: 'gifv', url: 'https://files.example.social/m2.mp4', previewUrl: 'https://files.example.social/m2-small.png',
    description: null, meta: { small: { width: 320, height: 180, size: '320x180', aspect: 16 / 9 } } },
]

export const SSR_STATUS_MEDIA = String.raw`<caribou-status-media ><template shadowroot="open" shadowrootmode="open"><!--lit-part C7z87hQe6Is=-->
      <div class="media">
        <!--lit-node 1--><div class="grid" data-count="2">
          <!--lit-part--><!--lit-part h8bSd7XYJcM=-->
            <!--lit-node 0--><div class="item" data-type="image" style="--ar: 1.3333333333333333">
              <!--lit-part 69iH8QauqnY=-->
          <!--lit-node 0--><a class="thumb" href="https://files.example.social/m1.png" target="_blank" rel="noopener noreferrer"
            aria-label="Open image: A red fox in the snow"
            >
            <!--lit-node 1--><img src="https://files.example.social/m1-small.png" alt="A red fox in the snow" loading="lazy" decoding="async" />
          </a>
        <!--/lit-part--><!--lit-part L96odo29kcY=-->
      <!--lit-node 0--><button type="button" class="alt" popovertarget="alt-0"
        aria-label="ALT, show the description">ALT</button>
      <!--lit-node 1--><div class="alt-text" id="alt-0" popover><!--lit-part-->A red fox in the snow<!--/lit-part--></div>
    <!--/lit-part-->
            </div>
          <!--/lit-part--><!--lit-part h8bSd7XYJcM=-->
            <!--lit-node 0--><div class="item" data-type="gifv" style="--ar: 1.7777777777777777">
              <!--lit-part /2XlG8BfQVg=-->
          <!--lit-node 0--><button type="button" class="gifv-toggle" aria-pressed="false"
            aria-label="Play GIF"
            >
            <!--lit-node 1--><video class="gifv" data-index="1" src="https://files.example.social/m2.mp4" poster="https://files.example.social/m2-small.png"
              muted loop playsinline preload="none"></video>
            <!--lit-part gByHETVSTYE=--><span class="gif-badge" aria-hidden="true">▶ GIF</span><!--/lit-part-->
          </button>
        <!--/lit-part--><!--lit-part--><!--/lit-part-->
            </div>
          <!--/lit-part--><!--/lit-part-->
        </div>
        <!--lit-part--><!--/lit-part-->
        <!--lit-part r2Gyk3UKu5E=-->
      <!--lit-node 0--><dialog aria-label="Image"  >
        <!--lit-part--><!--/lit-part-->
      </dialog>
    <!--/lit-part-->
      </div>
    <!--/lit-part--></template></caribou-status-media>`
