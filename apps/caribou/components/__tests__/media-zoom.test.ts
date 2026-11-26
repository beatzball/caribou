import { describe, expect, it } from 'vitest'
import {
  DOUBLE_TAP_SCALE, IDENTITY, MAX_SCALE, MIN_SCALE, clampPan, clampScale, doubleTap,
  isZoomed, panBy, pinch, transformOf, wheelScale, zoomAt, type Point, type Zoom,
} from '../_media-zoom.js'

const FRAME = { width: 400, height: 300 }

// Where an image point (from the center, at 1x) shows on screen.
const onScreen = (z: Zoom, p: Point): Point => ({ x: z.x + z.scale * p.x, y: z.y + z.scale * p.y })

describe('clampScale', () => {
  it('keeps the scale between 1x and 4x', () => {
    expect(clampScale(0.2)).toBe(MIN_SCALE)
    expect(clampScale(2)).toBe(2)
    expect(clampScale(9)).toBe(MAX_SCALE)
    expect(MIN_SCALE).toBe(1)
    expect(MAX_SCALE).toBe(4)
  })

  it('treats a scale that is not a number as 1x', () => {
    expect(clampScale(Number.NaN)).toBe(1)
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1)
  })
})

describe('clampPan', () => {
  it('centers the image at 1x', () => {
    expect(clampPan({ scale: 1, x: 50, y: -20 }, FRAME)).toEqual(IDENTITY)
  })

  it('lets an edge come to the frame edge, not past it', () => {
    // 2x: the image is 800×600, so it can move 200 left or right, 150 up or down.
    expect(clampPan({ scale: 2, x: 999, y: -999 }, FRAME)).toEqual({ scale: 2, x: 200, y: -150 })
    expect(clampPan({ scale: 2, x: -50, y: 20 }, FRAME)).toEqual({ scale: 2, x: -50, y: 20 })
  })

  it('keeps the image over the whole frame at every bound', () => {
    for (const scale of [1.2, 2, 3.7, 4]) {
      const z = clampPan({ scale, x: 1e6, y: -1e6 }, FRAME)
      // The image's left edge is at most the frame's left edge, and so on.
      expect(z.x - (scale * FRAME.width) / 2).toBeLessThanOrEqual(-FRAME.width / 2 + 1e-9)
      expect(z.y + (scale * FRAME.height) / 2).toBeGreaterThanOrEqual(FRAME.height / 2 - 1e-9)
    }
  })

  it('clamps the scale too, and drops a pan that is not a number', () => {
    expect(clampPan({ scale: 10, x: Number.NaN, y: 0 }, FRAME)).toEqual({ scale: 4, x: 0, y: 0 })
  })
})

describe('zoomAt', () => {
  it('keeps the image point under the given place', () => {
    const at = { x: 60, y: -40 }
    const z = zoomAt(IDENTITY, 2, at, FRAME)
    expect(z.scale).toBe(2)
    // The image point that was under `at` at 1x is `at` itself.
    expect(onScreen(z, at)).toEqual(at)
  })

  it('composes: zooming twice about one place is one zoom about it', () => {
    const at = { x: -30, y: 25 }
    const twice = zoomAt(zoomAt(IDENTITY, 1.5, at, FRAME), 3, at, FRAME)
    const once = zoomAt(IDENTITY, 3, at, FRAME)
    expect(twice.scale).toBeCloseTo(once.scale)
    expect(twice.x).toBeCloseTo(once.x)
    expect(twice.y).toBeCloseTo(once.y)
  })

  it('stops at 4x and does not let the image leave the frame', () => {
    const z = zoomAt(IDENTITY, 20, { x: 200, y: 150 }, FRAME)
    expect(z).toEqual(clampPan(z, FRAME))
    expect(z.scale).toBe(4)
  })

  it('zooming out to 1x recenters the image', () => {
    const z = zoomAt({ scale: 3, x: 100, y: -80 }, 0.5, { x: 10, y: 10 }, FRAME)
    expect(z).toEqual(IDENTITY)
  })
})

describe('panBy', () => {
  it('moves a zoomed image and stops at the frame edge', () => {
    const z = { scale: 2, x: 0, y: 0 }
    expect(panBy(z, 30, -40, FRAME)).toEqual({ scale: 2, x: 30, y: -40 })
    expect(panBy(z, 5000, 5000, FRAME)).toEqual({ scale: 2, x: 200, y: 150 })
  })

  it('does not move the image at 1x', () => {
    expect(panBy(IDENTITY, 30, 30, FRAME)).toEqual(IDENTITY)
  })
})

describe('doubleTap', () => {
  it('zooms in to about 2.5x on the tapped point', () => {
    const at = { x: 40, y: 30 }
    const z = doubleTap(IDENTITY, at, FRAME)
    expect(z.scale).toBe(DOUBLE_TAP_SCALE)
    expect(DOUBLE_TAP_SCALE).toBe(2.5)
    expect(onScreen(z, at).x).toBeCloseTo(at.x)
    expect(onScreen(z, at).y).toBeCloseTo(at.y)
  })

  it('at the center, the image stays centered', () => {
    expect(doubleTap(IDENTITY, { x: 0, y: 0 }, FRAME)).toEqual({ scale: 2.5, x: 0, y: 0 })
  })

  it('near a corner, the image still covers the frame', () => {
    const z = doubleTap(IDENTITY, { x: 900, y: -900 }, FRAME)
    expect(z.scale).toBe(2.5)
    expect(z).toEqual(clampPan(z, FRAME))
    // 2.5x of 400×300: at most 300 sideways and 225 up or down.
    expect(z).toEqual({ scale: 2.5, x: -300, y: 225 })
  })

  it('on a zoomed image, goes back to 1x', () => {
    expect(doubleTap({ scale: 3, x: 50, y: 50 }, { x: 10, y: 10 }, FRAME)).toEqual(IDENTITY)
  })
})

describe('pinch', () => {
  it('scales by the change in distance about the start midpoint', () => {
    const mid = { x: 20, y: -10 }
    const z = pinch(IDENTITY, 100, mid, 200, mid, FRAME)
    expect(z.scale).toBe(2)
    expect(onScreen(z, mid)).toEqual(mid)
  })

  it('follows the midpoint as the fingers move', () => {
    const z = pinch(IDENTITY, 100, { x: 0, y: 0 }, 200, { x: 30, y: 20 }, FRAME)
    expect(z).toEqual({ scale: 2, x: 30, y: 20 })
  })

  it('starts from the zoom the gesture began at', () => {
    const z = pinch({ scale: 2, x: 0, y: 0 }, 100, { x: 0, y: 0 }, 150, { x: 0, y: 0 }, FRAME)
    expect(z.scale).toBe(3)
  })

  it('clamps the scale and the pan', () => {
    const z = pinch(IDENTITY, 10, { x: 0, y: 0 }, 1000, { x: 5000, y: 0 }, FRAME)
    expect(z).toEqual({ scale: 4, x: 600, y: 0 })
    expect(pinch(IDENTITY, 100, { x: 0, y: 0 }, 20, { x: 0, y: 0 }, FRAME)).toEqual(IDENTITY)
  })

  it('a zero start distance changes nothing', () => {
    expect(pinch({ scale: 2, x: 0, y: 0 }, 0, { x: 0, y: 0 }, 50, { x: 0, y: 0 }, FRAME).scale).toBe(2)
  })
})

describe('wheelScale', () => {
  it('zooms in on a wheel up and out on a wheel down', () => {
    expect(wheelScale(1, -10)).toBeGreaterThan(1)
    expect(wheelScale(2, 10)).toBeLessThan(2)
  })

  it('caps one big mouse notch', () => {
    expect(wheelScale(1, -1000)).toBeCloseTo(wheelScale(1, -50))
    expect(wheelScale(1, -1000)).toBeLessThan(2)
  })

  it('stays between 1x and 4x', () => {
    expect(wheelScale(1, 50)).toBe(1)
    expect(wheelScale(3.9, -50)).toBe(4)
  })
})

describe('transformOf', () => {
  it('is empty at 1x, so the image has no transform', () => {
    expect(transformOf(IDENTITY)).toBe('')
    expect(isZoomed(IDENTITY)).toBe(false)
  })

  it('translates, then scales, about the center', () => {
    expect(transformOf({ scale: 2, x: 10, y: -5 })).toBe('translate(10px, -5px) scale(2)')
    expect(isZoomed({ scale: 2, x: 0, y: 0 })).toBe(true)
  })
})
