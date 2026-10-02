import { LitElement, html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { pageReset } from '@beatzball/litro/runtime'

@customElement('page-blog')
export class BlogPage extends LitElement {
  // `<litro-link>` makes its anchor inherit color and decoration from the
  // host, so the host carries the browser's link look.
  static override styles = [pageReset, css`
    litro-link { color: LinkText; text-decoration: underline; }
  `]

  override render() {
    return html`
      <main>
        <h1>Blog</h1>
        <p>Choose a post:</p>
        <ul>
          <li><litro-link href="/blog/hello-world">Hello World</litro-link></li>
          <li><litro-link href="/blog/getting-started">Getting Started</litro-link></li>
          <li><litro-link href="/blog/about-litro">About Litro</litro-link></li>
        </ul>
        <litro-link href="/">← Back Home</litro-link>
      </main>
    `
  }
}

export default BlogPage
