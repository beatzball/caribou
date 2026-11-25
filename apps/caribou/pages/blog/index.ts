import { LitElement, html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { pageReset } from '@beatzball/litro/runtime'
import { spaClick } from '../../components/_spa-link.js'

@customElement('page-blog')
export class BlogPage extends LitElement {
  static override styles = [pageReset, css`
    litro-link, a { color: LinkText; text-decoration: underline; }
    li a { display: inline-flex; align-items: center; min-block-size: 44px; }
    li a:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
  `]

  override render() {
    return html`
      <main>
        <h1>Blog</h1>
        <p>Choose a post:</p>
        <ul>
          <li><a href="/blog/hello-world" @click=${spaClick}>Hello World</a></li>
          <li><a href="/blog/getting-started" @click=${spaClick}>Getting Started</a></li>
          <li><a href="/blog/about-litro" @click=${spaClick}>About Litro</a></li>
        </ul>
        <litro-link href="/">← Back Home</litro-link>
      </main>
    `
  }
}

export default BlogPage
