import { Elena, html } from '@elenajs/core';

export class BlogPage extends Elena(HTMLElement) {
  static override tagName = 'page-blog';

  override render() {
    return html`
      <main>
        <h1>Blog</h1>
        <p>Choose a post:</p>
        <ul>
          <li><litro-link><a href="/blog/hello-world">Hello World</a></litro-link></li>
          <li><litro-link><a href="/blog/getting-started">Getting Started</a></litro-link></li>
          <li><litro-link><a href="/blog/about-litro">About Litro</a></litro-link></li>
        </ul>
        <litro-link><a href="/">\u2190 Back Home</a></litro-link>
      </main>
    `;
  }
}

BlogPage.define();

export default BlogPage;
