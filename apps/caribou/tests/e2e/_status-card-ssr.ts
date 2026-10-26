// A boosted post as the server renders it in a signed-out timeline, and the
// status it was rendered from. `status-card-hydration.spec.ts` hydrates it in
// a real browser; `tests/integration/ssr-status-card.test.ts` fails if the
// server render stops matching it, so this copy cannot go stale.
//
// Stylesheets are left out (they sit outside Lit's template markers), and so
// is the timestamp's text (`withoutTime`): the server prints it in its own
// time zone, and hydration does not compare text.
export const SSR_STATUS = {
  id: 'w1', content: '', createdAt: '2026-04-28T13:00:00Z', visibility: 'public',
  account: { id: '2', acct: 'bob', username: 'bob', displayName: 'Bob', avatar: '', avatarStatic: '' },
  reblog: {
    id: '42', content: '<p>hello</p>', createdAt: '2026-04-28T12:00:00Z', visibility: 'public',
    account: { id: '1', acct: 'alice', username: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' },
    favourited: true, favouritesCount: 5, reblogged: false, reblogsCount: 0,
    bookmarked: false, repliesCount: 2,
  },
}

export const SSR_STATUS_CARD = String.raw`<caribou-status-card  variant="timeline"><template shadowroot="open" shadowrootmode="open"><!--lit-part MxHs2aOlVmU=-->
      <!--lit-node 0--><article data-variant="timeline">
        <!--lit-part xI1yegC+b3I=--><div class="boost-attribution">
                   <!--lit-node 1--><caribou-icon   class="boost-icon" name="repeat2" defer-hydration><template shadowroot="open" shadowrootmode="open"><!--lit-part 5qecDuV0+bI=--><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m2 9l3-3l3 3"/><path d="M13 18H7a2 2 0 0 1-2-2V6m17 9l-3 3l-3-3"/><path d="M11 6h6a2 2 0 0 1 2 2v10"/></g></svg><!--/lit-part--></template></caribou-icon>
                   <span><!--lit-part-->Bob<!--/lit-part--> boosted</span>
                 </div><!--/lit-part-->
        <div class="row">
          <!--lit-node 3--><img src=""
               alt=""
               width="48" height="48"
               loading="lazy"
               decoding="async"
                />
          <div class="body">
            <header>
              <strong><!--lit-part-->Alice<!--/lit-part--></strong>
              <span class="acct">@<!--lit-part-->alice<!--/lit-part--></span>
              <!--lit-node 10--><litro-link class="permalink" href="/@alice/42">
                <!--lit-node 11--><time datetime="2026-04-28T12:00:00Z"><!--lit-part--><!--/lit-part--></time>
              </litro-link>
            </header>
            <!--lit-node 13--><div class="status-content" ><!--lit-part Ypkg6K/Pp3E=--><p>hello</p><!--/lit-part--></div>
            <!--lit-part x0gb5fvNV/0=-->
      <div class="actions" role="group" aria-label="Post actions">
        <!--lit-node 1--><caribou-icon-button    
           
          
          
           class="reply" variant="ghost" icon="messageCircle" label="Reply" count="2" hint="Sign in to reply" description="2 replies. Sign in to reply" soft-disabled defer-hydration><template shadowroot="open" shadowrootmode="open" shadowrootdelegatesfocus><!--lit-part Jp3VQEGp6iI=--><!--lit-node 0--><button type="button" part="button"
      data-variant="ghost"
      aria-label="Reply" title="Sign in to reply"
      
      aria-disabled="true"
      aria-describedby="description"
      ><!--lit-node 1--><caribou-icon   
         part="icon" aria-hidden="true" name="messageCircle" defer-hydration><template shadowroot="open" shadowrootmode="open"><!--lit-part ArdpaebyS+k=--><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg><!--/lit-part--></template></caribou-icon><!--lit-part pDDEKdI3Jek=--><span class="count" part="count"><!--lit-part-->2<!--/lit-part--></span><!--/lit-part--></button><span
      class="sr-only" id="description"><!--lit-part-->2 replies. Sign in to reply<!--/lit-part--></span><!--/lit-part--></template></caribou-icon-button>
        <!--lit-node 2--><caribou-icon-button    
          
           
          
          
           class="boost" variant="ghost" icon="repeat2" label="Boost" pressed="false" count hint="Sign in to boost" description="0 boosts. Sign in to boost" soft-disabled defer-hydration><template shadowroot="open" shadowrootmode="open" shadowrootdelegatesfocus><!--lit-part Jp3VQEGp6iI=--><!--lit-node 0--><button type="button" part="button"
      data-variant="ghost"
      aria-label="Boost" title="Sign in to boost"
      aria-pressed="false"
      aria-disabled="true"
      aria-describedby="description"
      ><!--lit-node 1--><caribou-icon   
         part="icon" aria-hidden="true" name="repeat2" defer-hydration><template shadowroot="open" shadowrootmode="open"><!--lit-part 5qecDuV0+bI=--><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m2 9l3-3l3 3"/><path d="M13 18H7a2 2 0 0 1-2-2V6m17 9l-3 3l-3-3"/><path d="M11 6h6a2 2 0 0 1 2 2v10"/></g></svg><!--/lit-part--></template></caribou-icon><!--lit-part--><!--/lit-part--></button><span
      class="sr-only" id="description"><!--lit-part-->0 boosts. Sign in to boost<!--/lit-part--></span><!--/lit-part--></template></caribou-icon-button>
        <!--lit-node 3--><caribou-icon-button    
          
           
          
          
           class="favourite" variant="ghost" icon="star" label="Unfavourite" pressed="true" count="5" hint="Sign in to favourite" description="5 favourites. Sign in to favourite" soft-disabled defer-hydration><template shadowroot="open" shadowrootmode="open" shadowrootdelegatesfocus><!--lit-part Jp3VQEGp6iI=--><!--lit-node 0--><button type="button" part="button"
      data-variant="ghost"
      aria-label="Unfavourite" title="Sign in to favourite"
      aria-pressed="true"
      aria-disabled="true"
      aria-describedby="description"
      ><!--lit-node 1--><caribou-icon   
         part="icon" aria-hidden="true" name="star" filled defer-hydration><template shadowroot="open" shadowrootmode="open"><!--lit-part cwz0XMK4Ycs=--><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.12 2.12 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.12 2.12 0 0 0 1.597-1.16z"/></svg><!--/lit-part--></template></caribou-icon><!--lit-part pDDEKdI3Jek=--><span class="count" part="count"><!--lit-part-->5<!--/lit-part--></span><!--/lit-part--></button><span
      class="sr-only" id="description"><!--lit-part-->5 favourites. Sign in to favourite<!--/lit-part--></span><!--/lit-part--></template></caribou-icon-button>
        <!--lit-node 4--><caribou-icon-button    
          
           
          
           class="bookmark" variant="ghost" icon="bookmark" label="Bookmark" pressed="false" hint="Sign in to bookmark" description="Sign in to bookmark" soft-disabled defer-hydration><template shadowroot="open" shadowrootmode="open" shadowrootdelegatesfocus><!--lit-part Jp3VQEGp6iI=--><!--lit-node 0--><button type="button" part="button"
      data-variant="ghost"
      aria-label="Bookmark" title="Sign in to bookmark"
      aria-pressed="false"
      aria-disabled="true"
      aria-describedby="description"
      ><!--lit-node 1--><caribou-icon   
         part="icon" aria-hidden="true" name="bookmark" defer-hydration><template shadowroot="open" shadowrootmode="open"><!--lit-part woyGQoeAfDg=--><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width="1em" height="1em" aria-hidden="true"
    style="display:inline-block;vertical-align:-0.125em"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19 21l-7-4l-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/></svg><!--/lit-part--></template></caribou-icon><!--lit-part--><!--/lit-part--></button><span
      class="sr-only" id="description"><!--lit-part-->Sign in to bookmark<!--/lit-part--></span><!--/lit-part--></template></caribou-icon-button>
      </div>
    <!--/lit-part-->
          </div>
        </div>
      </article>
    <!--/lit-part--></template></caribou-status-card>`

export function withoutTime(markup: string): string {
  return markup.replace(/(<time [^>]*><!--lit-part-->)[^<]*/, '$1')
}
