// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { html } from 'lit'
import { ssr } from './_ssr.js'
import { parseChangelog } from '../../server/lib/changelog.js'
import { PACKAGE_VERSION } from '../../server/build-meta.generated.js'
import '../../pages/changelog.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({
  resolveInstanceForRoute: async () => ({ instance: null, source: 'none' }),
}))

const PREFIX = (n: number) => `[#${n}](https://github.com/beatzball/caribou/pull/${n}) [\`abc1234\`](https://github.com/beatzball/caribou/commit/abc1234) Thanks [@beatzball](https://github.com/beatzball)! - `

const MD = [
  '# caribou-app', '',
  '## 0.11.0', '', '### Minor Changes', '',
  `- ${PREFIX(150)}A **new** page at \`/changelog\` <script>alert(1)</script> [bad](javascript:alert(1)).`, '',
  '## 0.10.0', '', '### Patch Changes', '',
  '- Updated dependencies [[`a`](https://example.com/a)]:', '  - @beatzball/caribou-state@0.4.1', '',
].join('\n')

const page = (releases = parseChangelog(MD)) => ssr(html`<page-changelog
  .serverData=${{ shell: { instance: null }, releases }}></page-changelog>`)

describe('/changelog SSR', () => {
  it('renders every version newest first, each with its own anchor', async () => {
    const out = await page()
    const ids = [...out.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toEqual(['v0-11-0', 'v0-10-0'])
    expect(out).toContain('href="#v0-11-0"')
    expect(out).toMatch(/Version (<!--[^>]*-->)*0\.11\.0/)
  })

  it('opens the newest version and leaves the others closed', async () => {
    const out = await page()
    const details = [...out.matchAll(/<details[^>]*>/g)].map((m) => m[0])
    expect(details[0]).toMatch(/\bopen\b/)
    expect(details[1]).not.toMatch(/\bopen\b/)
  })

  it('renders the markdown as text, never as HTML', async () => {
    const out = await page()
    expect(out).not.toContain('<script>alert(1)</script>')
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(out).not.toContain('javascript:')
    expect(out).toMatch(/<strong>(<!--[^>]*-->)*new(<!--[^>]*-->)*<\/strong>/)
    expect(out).toMatch(/<code>(<!--[^>]*-->)*\/changelog(<!--[^>]*-->)*<\/code>/)
  })

  it('links each change to its pull request, without the commit or the thanks', async () => {
    const out = await page()
    expect(out).toContain('href="https://github.com/beatzball/caribou/pull/150"')
    expect(out).toContain('aria-label="Pull request 150"')
    expect(out).not.toContain('Thanks')
    expect(out).not.toContain('/commit/')
  })

  // CSS generated content is read out, so the open/closed glyph sits in a
  // span that is hidden from assistive tech.
  it('hides the disclosure glyph from assistive tech', async () => {
    const out = await page()
    expect(out).toMatch(/<summary><span class="marker" aria-hidden="true"><\/span>/)
  })

  it('says so when a version has no change for readers', async () => {
    const out = await page()
    expect(out).toContain('Internal changes only.')
  })

  it('names the running version', async () => {
    const out = await page([])
    expect(out).toContain(`You are using version <!--lit-part-->${PACKAGE_VERSION}`)
  })

  it('pageData sends the parsed changelog of this build', async () => {
    const { pageData } = await import('../../pages/changelog.js')
    const data = await pageData.fetcher({} as Parameters<typeof pageData.fetcher>[0])
    expect(data.shell).toEqual({ instance: null })
    expect(data.releases[0]!.version).toBe(PACKAGE_VERSION)
  })
})
