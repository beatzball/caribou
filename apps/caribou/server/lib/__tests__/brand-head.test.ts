// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { APP_NAME, ICONS_HEAD, PAGE_TITLE, THEME_COLOR, brandHead } from '../brand-head.js'

const appRoot = resolve(__dirname, '../../..')
const publicDir = resolve(appRoot, 'public')
const tokensCss = readFileSync(resolve(appRoot, '../../packages/design-tokens/tokens.css'), 'utf8')

// Width and height from a PNG's IHDR chunk.
function pngSize(file: string): string {
  const bytes = readFileSync(file)
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG')
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
}

// Every same-site file the head points at.
function linkedFiles(head: string): string[] {
  return [...head.matchAll(/(?:href|content)="(?:https?:\/\/[^/"]+)?(\/[^"]+)"/g)].map((m) => m[1]!)
}

describe('brand head', () => {
  it('names the app Caribou', () => {
    expect(APP_NAME).toBe('Caribou')
    expect(PAGE_TITLE).toBe('Caribou')
  })

  it('links the icons, the manifest and the theme colour', () => {
    const head = brandHead('https://caribou.quest')
    expect(head).toContain('<link rel="icon" href="/favicon.ico"')
    expect(head).toContain('<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />')
    expect(head).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
    expect(head).toContain('<link rel="manifest" href="/site.webmanifest" />')
    expect(head).toContain(`<meta name="theme-color" content="${THEME_COLOR}" />`)
  })

  it('gives link previews the name and an absolute image URL', () => {
    const head = brandHead('https://caribou.quest')
    expect(head).toContain('<meta property="og:site_name" content="Caribou" />')
    expect(head).toContain('<meta property="og:title" content="Caribou" />')
    expect(head).toContain('<meta property="og:image" content="https://caribou.quest/og-image.png" />')
    expect(head).toContain('<meta name="twitter:card" content="summary" />')
  })

  it('escapes the origin, which can come from the Host header', () => {
    const head = brandHead('http://x"><script>')
    expect(head).not.toContain('<script>')
    expect(head).toContain('content="http://x&quot;&gt;&lt;script&gt;/og-image.png"')
  })

  it('points only at files that exist in public/', () => {
    const files = linkedFiles(brandHead('https://caribou.quest'))
    expect(files).toContain('/og-image.png')
    for (const file of files) expect(existsSync(resolve(publicDir, `.${file}`)), file).toBe(true)
    for (const file of linkedFiles(ICONS_HEAD)) expect(existsSync(resolve(publicDir, `.${file}`)), file).toBe(true)
  })

  it('gives the og:image the size it declares', () => {
    expect(pngSize(resolve(publicDir, 'og-image.png'))).toBe('512x512')
  })

  it('uses the page background from the design tokens as the theme colour', () => {
    const bg0 = /:root[^{]*\{[^}]*--bg-0:\s*(#[0-9a-f]{6})/i.exec(tokensCss)?.[1]
    expect(THEME_COLOR).toBe(bg0)
  })
})

describe('site.webmanifest', () => {
  const manifest = JSON.parse(readFileSync(resolve(publicDir, 'site.webmanifest'), 'utf8')) as {
    name: string
    short_name: string
    theme_color: string
    background_color: string
    icons: { src: string; sizes: string; type: string; purpose: string }[]
  }

  it('names the app and uses the theme colour', () => {
    expect(manifest.name).toBe(APP_NAME)
    expect(manifest.short_name).toBe(APP_NAME)
    expect(manifest.theme_color).toBe(THEME_COLOR)
    expect(manifest.background_color).toBe(THEME_COLOR)
  })

  it('lists icons that exist, at the size it says', () => {
    expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
      '192x192 any', '512x512 any', '512x512 maskable',
    ])
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png')
      expect(pngSize(resolve(publicDir, `.${icon.src}`))).toBe(icon.sizes)
    }
  })

  it('has a 180px apple-touch-icon', () => {
    expect(pngSize(resolve(publicDir, 'apple-touch-icon.png'))).toBe('180x180')
  })
})
