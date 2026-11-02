// Reads the app's CHANGELOG.md (written by Changesets) into plain data that
// `pages/changelog.ts` renders with Lit templates. Nothing from the file is
// ever used as HTML: a tag in it is text, and only http(s) links become
// links. It reads the subset Changesets writes: `## <version>`,
// `### <group>`, bullets with indented continuation lines and sub-bullets,
// `code`, **strong** and [links](https://…).

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Item[] }

export interface Item {
  /** The pull request a Changesets entry names in its prefix. */
  pr?: { number: number; href: string }
  blocks: Block[]
}

export interface Group { title: string; items: Item[] }

export interface Release { version: string; groups: Group[] }

/** The id of a version's section: `0.10.2` → `v0-10-2`. */
export function versionAnchor(version: string): string {
  return `v${version.replace(/[^a-zA-Z0-9]+/g, '-')}`
}

// `[#140](url) [`sha`](url) Thanks [@name](url)! - ` — the readers of the
// page want the change, not the commit or the author. The PR stays as a link.
// @changesets/changelog-github leaves out each part it has no value for: the
// PR for a commit that reached main without one, the thanks when it finds
// no GitHub user. At least one part must be there.
const USER = String.raw`\[@[^\]]+\]\([^)\s]+\)`
const PR_PART = String.raw`\[#(\d+)\]\((https:\/\/[^)\s]+)\)\s+`
const COMMIT_PART = String.raw`\[\x60[0-9a-f]+\x60\]\([^)\s]+\)\s+`
const THANKS_PART = String.raw`Thanks\s+${USER}(?:(?:,\s*|\s+and\s+)${USER})*!\s+`
const CHANGESET_PREFIX = new RegExp(`^(?:${PR_PART})?(?:${COMMIT_PART})?(?:${THANKS_PART})?-\\s+`)

const SAFE_URL = /^https?:\/\//i

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = () => { if (text) { out.push({ t: 'text', v: text }); text = '' } }
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()#!<>-]/.test(src[i + 1]!)) {
      text += src[i + 1]; i += 2; continue
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i + 1) { flush(); out.push({ t: 'code', v: src.slice(i + 1, end) }); i = end + 1; continue }
    }
    if (ch === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2)
      if (end > i + 2) {
        flush(); out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) }); i = end + 2; continue
      }
    }
    if (ch === '[') {
      const link = readLink(src, i)
      if (link) {
        flush()
        const c = parseInline(link.label)
        if (SAFE_URL.test(link.href)) out.push({ t: 'link', href: link.href, c })
        else out.push(...c)
        i = link.end
        continue
      }
    }
    text += ch; i++
  }
  flush()
  return merge(out)
}

// `[label](href)`, with brackets in the label balanced (`[[`sha`](url)]`).
function readLink(src: string, start: number): { label: string; href: string; end: number } | null {
  let depth = 0
  let j = start
  for (; j < src.length; j++) {
    if (src[j] === '[') depth++
    else if (src[j] === ']' && --depth === 0) break
  }
  if (j >= src.length || src[j + 1] !== '(') return null
  let pdepth = 0
  let k = j + 1
  for (; k < src.length; k++) {
    if (src[k] === '(') pdepth++
    else if (src[k] === ')' && --pdepth === 0) break
  }
  if (k >= src.length) return null
  const href = src.slice(j + 2, k).trim()
  if (/\s/.test(href)) return null
  return { label: src.slice(start + 1, j), href, end: k + 1 }
}

// A text node next to a text node, after an unsafe link fell back to its label.
function merge(list: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const n of list) {
    const prev = out[out.length - 1]
    if (n.t === 'text' && prev?.t === 'text') prev.v += n.v
    else out.push(n)
  }
  return out
}

const BULLET = /^[-*] /

// Paragraphs and bullet lists from lines that are already dedented to this level.
function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  const endPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ')) })
    para = []
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') { endPara(); i++; continue }
    if (BULLET.test(line)) {
      endPara()
      const items: Item[] = []
      while (i < lines.length && BULLET.test(lines[i]!)) {
        const body = [lines[i]!.slice(2)]
        i++
        // The item goes on while lines are indented, or blank with an
        // indented line after them.
        while (i < lines.length) {
          const l = lines[i]!
          if (l.startsWith('  ')) { body.push(l.slice(2)); i++; continue }
          if (l.trim() === '') {
            let n = i
            while (n < lines.length && lines[n]!.trim() === '') n++
            if (n < lines.length && lines[n]!.startsWith('  ')) { body.push(''); i++; continue }
          }
          break
        }
        items.push(toItem(body))
        while (i < lines.length && lines[i]!.trim() === '' && BULLET.test(lines[i + 1] ?? '')) i++
      }
      blocks.push({ t: 'ul', items })
      continue
    }
    para.push(line.trim())
    i++
  }
  endPara()
  return blocks
}

// A Changesets prefix becomes the item's `pr`; the rest is the item's text.
function toItem(body: string[]): Item {
  const m = CHANGESET_PREFIX.exec(body[0]!)
  // A match of the bare ` - ` alone is the item's own text, not a prefix.
  if (!m || m[0].startsWith('-')) return { blocks: parseBlocks(body) }
  const lines = [body[0]!.slice(m[0].length), ...body.slice(1)]
  const blocks = parseBlocks(lines)
  return m[1] ? { pr: { number: Number(m[1]), href: m[2]! }, blocks } : { blocks }
}

function isDependencyBump(item: Item): boolean {
  const first = item.blocks[0]
  const lead = first?.t === 'p' ? first.c[0] : undefined
  return lead?.t === 'text' && lead.v.startsWith('Updated dependencies')
}

export function parseChangelog(md: string): Release[] {
  const releases: Release[] = []
  let release: Release | null = null
  let group: { title: string; lines: string[] } | null = null

  const endGroup = () => {
    if (!release || !group) return
    const items = parseBlocks(group.lines)
      .flatMap((b) => (b.t === 'ul' ? b.items : []))
      .filter((it) => !isDependencyBump(it))
    if (items.length) release.groups.push({ title: group.title, items })
    group = null
  }

  for (const line of md.split(/\r?\n/)) {
    const h2 = /^## (.+)$/.exec(line)
    if (h2) {
      endGroup()
      release = { version: h2[1]!.trim(), groups: [] }
      releases.push(release)
      continue
    }
    const h3 = /^### (.+)$/.exec(line)
    if (h3 && release) {
      endGroup()
      group = { title: h3[1]!.trim(), lines: [] }
      continue
    }
    if (group) group.lines.push(line)
  }
  endGroup()
  return releases
}
