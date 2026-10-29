#!/usr/bin/env node
// Regenerate the favicon, app icons and the social preview image from the
// logo source. Run it after the logo changes:
//
//   pnpm --filter caribou-app icons
//
// It needs ImageMagick 7 (`magick`) on the PATH. It is not part of the build:
// the outputs are committed, so a build machine and the Docker image need no
// image tools.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(appRoot, 'assets-src/caribou-logo.png')
const publicDir = resolve(appRoot, 'public')

// The page background (`--bg-0` in packages/design-tokens/tokens.css). iOS
// fills a transparent touch icon with black, and a maskable icon must be
// opaque, so those two sit on this colour.
const BACKGROUND = '#0d0d12'

// No metadata and no timestamps, so the same source gives the same bytes.
// A 256-colour palette would make the files several times smaller, but it
// bands or speckles the gradients, so the icons stay full colour.
const PNG_OUT = ['-strip', '-define', 'png:exclude-chunks=date,time', '-define', 'png:compression-level=9']

const magick = (...args) => execFileSync('magick', args, { stdio: 'inherit' })

const work = mkdtempSync(join(tmpdir(), 'caribou-icons-'))
try {
  // The source has wide transparent margins. Cut them off and centre the
  // logo on a square, so each icon below sets its own margin.
  const square = join(work, 'square.png')
  magick(source, '-trim', '+repage', '-background', 'none', '-gravity', 'center',
    '-extent', '%[fx:max(w,h)]x%[fx:max(w,h)]', square)

  // `inset` is the fraction of the icon the logo fills.
  const icon = (out, size, { inset = 1, background = 'none' } = {}) => {
    const inner = Math.round(size * inset)
    // An icon on a background is opaque: drop the alpha channel, which
    // makes the file about a fifth smaller.
    const opaque = background === 'none' ? [] : ['-alpha', 'remove', '-alpha', 'off']
    magick(square, '-filter', 'Lanczos', '-resize', `${inner}x${inner}`,
      '-background', background, '-gravity', 'center', '-extent', `${size}x${size}`,
      ...opaque, ...PNG_OUT, out)
  }

  const ico = [16, 32, 48].map((size) => {
    const out = join(work, `ico-${size}.png`)
    icon(out, size)
    return out
  })
  magick(...ico, '-strip', join(publicDir, 'favicon.ico'))

  icon(join(publicDir, 'logo.png'), 128)
  icon(join(publicDir, 'icon-192.png'), 192, { inset: 0.9 })
  icon(join(publicDir, 'icon-512.png'), 512, { inset: 0.9 })
  icon(join(publicDir, 'apple-touch-icon.png'), 180, { inset: 0.76, background: BACKGROUND })
  // A maskable icon can be cut to a circle of 80% of its width. A square that
  // fits in that circle is about 57% wide.
  icon(join(publicDir, 'icon-maskable-512.png'), 512, { inset: 0.56, background: BACKGROUND })
  icon(join(publicDir, 'og-image.png'), 512, { inset: 0.72, background: BACKGROUND })
} finally {
  rmSync(work, { recursive: true, force: true })
}

for (const name of ['favicon.ico', 'logo.png', 'icon-192.png', 'icon-512.png',
  'apple-touch-icon.png', 'icon-maskable-512.png', 'og-image.png']) {
  console.log(`[icons] ${name} ${statSync(join(publicDir, name)).size} bytes`)
}
