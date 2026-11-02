// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseChangelog, parseInline, versionAnchor } from '../changelog.js'

const PREFIX = '[#140](https://github.com/beatzball/caribou/pull/140) [`3ec8db2`](https://github.com/beatzball/caribou/commit/3ec8db2) Thanks [@beatzball](https://github.com/beatzball)! - '

describe('parseInline', () => {
  it('reads text, code, strong and links', () => {
    expect(parseInline('Open `/` and **see** [the docs](https://example.com/a).')).toEqual([
      { t: 'text', v: 'Open ' },
      { t: 'code', v: '/' },
      { t: 'text', v: ' and ' },
      { t: 'strong', c: [{ t: 'text', v: 'see' }] },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'https://example.com/a', c: [{ t: 'text', v: 'the docs' }] },
      { t: 'text', v: '.' },
    ])
  })

  it('keeps raw HTML as text', () => {
    expect(parseInline('a <img src=x onerror=alert(1)> b')).toEqual([
      { t: 'text', v: 'a <img src=x onerror=alert(1)> b' },
    ])
  })

  it('makes a link with a non-http URL plain text', () => {
    expect(parseInline('[click](javascript:alert(1))')).toEqual([{ t: 'text', v: 'click' }])
  })

  it('leaves an unclosed backtick or star as text', () => {
    expect(parseInline('a ` b ** c')).toEqual([{ t: 'text', v: 'a ` b ** c' }])
  })

  it('reads a backslash escape as the plain character', () => {
    expect(parseInline('a \\* b')).toEqual([{ t: 'text', v: 'a * b' }])
  })
})

describe('parseChangelog', () => {
  it('reads versions newest first, with groups and items', () => {
    const md = [
      '# caribou-app', '',
      '## 0.10.2', '', '### Patch Changes', '',
      `- ${PREFIX}Open \`/\` while signed in.`, '',
      '- Updated dependencies [[`67283c2`](https://github.com/beatzball/caribou/commit/67283c2)]:',
      '  - @beatzball/caribou-state@0.4.1', '',
      '## 0.10.0', '', '### Minor Changes', '',
      `- ${PREFIX}First line`, '  goes on here.',
      '  - A sub point.', '  - Another.', '',
      '  A second paragraph.', '',
    ].join('\n')
    const releases = parseChangelog(md)
    expect(releases.map((r) => r.version)).toEqual(['0.10.2', '0.10.0'])
    expect(releases[0]!.groups).toEqual([{
      title: 'Patch Changes',
      items: [{
        pr: { number: 140, href: 'https://github.com/beatzball/caribou/pull/140' },
        blocks: [{ t: 'p', c: [{ t: 'text', v: 'Open ' }, { t: 'code', v: '/' }, { t: 'text', v: ' while signed in.' }] }],
      }],
    }])
    expect(releases[1]!.groups[0]!.items[0]!.blocks).toEqual([
      { t: 'p', c: [{ t: 'text', v: 'First line goes on here.' }] },
      { t: 'ul', items: [
        { blocks: [{ t: 'p', c: [{ t: 'text', v: 'A sub point.' }] }] },
        { blocks: [{ t: 'p', c: [{ t: 'text', v: 'Another.' }] }] },
      ] },
      { t: 'p', c: [{ t: 'text', v: 'A second paragraph.' }] },
    ])
  })

  it('drops "Updated dependencies" items and groups left empty', () => {
    const md = '## 0.2.1\n\n### Patch Changes\n\n- Updated dependencies [[`a`](https://x.test/a)]:\n  - @beatzball/x@1.0.0\n'
    expect(parseChangelog(md)).toEqual([{ version: '0.2.1', groups: [] }])
  })

  // @changesets/changelog-github leaves out the PR link for a commit with no
  // PR, and the thanks when it finds no GitHub user for the commit.
  it('strips a prefix with no PR link', () => {
    const md = '## 1.0.0\n\n### Patch Changes\n\n- [`3ec8db2`](https://github.com/o/r/commit/3ec8db2) Thanks [@a](https://github.com/a)! - Fixed.\n'
    expect(parseChangelog(md)[0]!.groups[0]!.items).toEqual([
      { blocks: [{ t: 'p', c: [{ t: 'text', v: 'Fixed.' }] }] },
    ])
  })

  it('strips a prefix with no thanks, or with several people thanked', () => {
    const md = [
      '## 1.0.0', '', '### Patch Changes', '',
      '- [#7](https://github.com/o/r/pull/7) [`3ec8db2`](https://github.com/o/r/commit/3ec8db2) - One.', '',
      '- [#8](https://github.com/o/r/pull/8) [`3ec8db2`](https://github.com/o/r/commit/3ec8db2) Thanks [@a](https://github.com/a), [@b](https://github.com/b)! - Two.', '',
      '- [`3ec8db2`](https://github.com/o/r/commit/3ec8db2) - Three.', '',
    ].join('\n')
    expect(parseChangelog(md)[0]!.groups[0]!.items).toEqual([
      { pr: { number: 7, href: 'https://github.com/o/r/pull/7' }, blocks: [{ t: 'p', c: [{ t: 'text', v: 'One.' }] }] },
      { pr: { number: 8, href: 'https://github.com/o/r/pull/8' }, blocks: [{ t: 'p', c: [{ t: 'text', v: 'Two.' }] }] },
      { blocks: [{ t: 'p', c: [{ t: 'text', v: 'Three.' }] }] },
    ])
  })

  it('leaves a plain item that starts with a dash alone', () => {
    const md = '## 1.0.0\n\n### Patch Changes\n\n- - odd but plain.\n'
    expect(JSON.stringify(parseChangelog(md))).toContain('odd but plain.')
  })

  it('keeps an item that has no changesets prefix', () => {
    const md = '## 1.0.0\n\n### Major Changes\n\n- Plain note.\n'
    expect(parseChangelog(md)[0]!.groups[0]!.items).toEqual([
      { blocks: [{ t: 'p', c: [{ t: 'text', v: 'Plain note.' }] }] },
    ])
  })

  it('parses the real CHANGELOG.md, every version once', () => {
    const md = readFileSync(resolve(__dirname, '../../../CHANGELOG.md'), 'utf8')
    const releases = parseChangelog(md)
    const headings = md.match(/^## .+$/gm)!.map((h) => h.slice(3).trim())
    expect(releases.map((r) => r.version)).toEqual(headings)
    expect(JSON.stringify(releases)).not.toContain('Updated dependencies')
    expect(JSON.stringify(releases)).not.toContain('Thanks [@')
  })
})

describe('versionAnchor', () => {
  it('makes an id from a version', () => {
    expect(versionAnchor('0.10.2')).toBe('v0-10-2')
    expect(versionAnchor('1.0.0-beta.1')).toBe('v1-0-0-beta-1')
  })
})
