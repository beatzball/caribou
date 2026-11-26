import { describe, expect, it } from 'vitest'
import {
  CLOSE_AT, FADE_OUT_AT, FLICK, FLICK_MIN_PX, VELOCITY_WINDOW_MS, fade, progress, shouldClose, velocity,
} from '../_media-swipe.js'

const H = 600
// Just under and just over a value.
const below = (v: number) => v - 0.01
const above = (v: number) => v + 0.01

describe('progress', () => {
  it('is the share of the stage height, either way, up to 1', () => {
    expect(progress(0, H)).toBe(0)
    expect(progress(150, H)).toBe(0.25)
    expect(progress(-150, H)).toBe(0.25)
    expect(progress(H, H)).toBe(1)
    expect(progress(3 * H, H)).toBe(1)
  })

  it('is 0 with no stage height or no number', () => {
    expect(progress(100, 0)).toBe(0)
    expect(progress(100, -10)).toBe(0)
    expect(progress(100, Number.NaN)).toBe(0)
    expect(progress(Number.NaN, H)).toBe(0)
  })
})

describe('fade', () => {
  it('is 1 at rest and 0 at FADE_OUT_AT of the height, the same up and down', () => {
    expect(fade(0, H)).toBe(1)
    expect(fade((FADE_OUT_AT * H) / 2, H)).toBeCloseTo(0.5)
    expect(fade((-FADE_OUT_AT * H) / 2, H)).toBeCloseTo(0.5)
    expect(fade(FADE_OUT_AT * H, H)).toBe(0)
  })

  it('just before the end there is a little dim left; past it, none', () => {
    expect(fade(below(FADE_OUT_AT * H), H)).toBeGreaterThan(0)
    expect(fade(above(FADE_OUT_AT * H), H)).toBe(0)
    expect(fade(10 * H, H)).toBe(0)
  })

  it('does not fade with no stage height', () => {
    expect(fade(200, 0)).toBe(1)
  })
})

describe('shouldClose', () => {
  const at = CLOSE_AT * H

  it('by distance: not just below the threshold, yes at and just above it, either way', () => {
    expect(shouldClose(below(at), 0, H)).toBe(false)
    expect(shouldClose(at, 0, H)).toBe(true)
    expect(shouldClose(above(at), 0, H)).toBe(true)
    expect(shouldClose(-below(at), 0, H)).toBe(false)
    expect(shouldClose(-above(at), 0, H)).toBe(true)
  })

  it('by a flick in the drag direction: not just below FLICK, yes at and above it', () => {
    expect(shouldClose(40, below(FLICK), H)).toBe(false)
    expect(shouldClose(40, FLICK, H)).toBe(true)
    expect(shouldClose(40, above(FLICK), H)).toBe(true)
    // Up, flicked up.
    expect(shouldClose(-40, -FLICK, H)).toBe(true)
    expect(shouldClose(-40, -below(FLICK), H)).toBe(false)
  })

  it('a flick needs FLICK_MIN_PX of travel, so a jittery tap is not one', () => {
    expect(shouldClose(below(FLICK_MIN_PX), 5, H)).toBe(false)
    expect(shouldClose(FLICK_MIN_PX, 5, H)).toBe(true)
    expect(shouldClose(-FLICK_MIN_PX, -5, H)).toBe(true)
  })

  it('a flick the wrong way (back toward the start) never closes, even past the threshold', () => {
    expect(shouldClose(40, -5, H)).toBe(false)
    expect(shouldClose(-40, 5, H)).toBe(false)
    expect(shouldClose(2 * at, -FLICK, H)).toBe(false)
    expect(shouldClose(-2 * at, FLICK, H)).toBe(false)
    // Slower than a flick back: the distance still counts.
    expect(shouldClose(2 * at, -below(FLICK), H)).toBe(true)
  })

  it('with no stage height, no travel, or no number, nothing closes', () => {
    expect(shouldClose(2 * at, 0, 0)).toBe(false)
    expect(shouldClose(100, 5, 0)).toBe(false)
    expect(shouldClose(100, 5, -1)).toBe(false)
    expect(shouldClose(0, 5, H)).toBe(false)
    expect(shouldClose(Number.NaN, 5, H)).toBe(false)
    // A speed that is not a number is no speed: the distance decides.
    expect(shouldClose(above(at), Number.NaN, H)).toBe(true)
    expect(shouldClose(40, Number.NaN, H)).toBe(false)
  })
})

describe('velocity', () => {
  it('is 0 with fewer than two samples', () => {
    expect(velocity([])).toBe(0)
    expect(velocity([{ y: 10, t: 5 }])).toBe(0)
  })

  it('is px per ms over the last moments, down positive', () => {
    expect(velocity([{ y: 0, t: 0 }, { y: 50, t: 50 }, { y: 100, t: 100 }])).toBe(1)
    expect(velocity([{ y: 0, t: 0 }, { y: -30, t: 60 }])).toBe(-0.5)
  })

  it('reads only VELOCITY_WINDOW_MS before the last sample: the edge sample counts, older ones do not', () => {
    const w = VELOCITY_WINDOW_MS
    expect(velocity([{ y: 0, t: 0 }, { y: 100, t: w }])).toBe(100 / w)
    // The first sample is just outside the window: only the last two count.
    expect(velocity([{ y: 0, t: 0 }, { y: 90, t: 1 }, { y: 100, t: w + 0.5 }])).toBeCloseTo(10 / (w - 0.5))
  })

  it('after a turn only the last stroke counts: a quick move back reads as a move back', () => {
    // Down 60px over 90ms, then back 40px in 16ms, then let go at once.
    const samples = [
      { y: 0, t: 0 }, { y: 30, t: 45 }, { y: 60, t: 90 },
      { y: 40, t: 98 }, { y: 20, t: 106 }, { y: 20, t: 106 },
    ]
    expect(velocity(samples)).toBe(-40 / 16)
    expect(shouldClose(20, velocity(samples), 50)).toBe(false)
    // The same moves with no turn: the whole window counts.
    expect(velocity([{ y: 0, t: 0 }, { y: 30, t: 45 }, { y: 60, t: 90 }])).toBeCloseTo(60 / 90)
  })

  it('a pause in the middle of a stroke does not end it', () => {
    expect(velocity([{ y: 0, t: 0 }, { y: 20, t: 20 }, { y: 20, t: 40 }, { y: 60, t: 60 }])).toBe(1)
  })

  it('a pointer that stopped, then let go, is not moving', () => {
    // A fast drag, a pause, then the release at the same place.
    expect(velocity([{ y: 0, t: 0 }, { y: 200, t: 20 }, { y: 200, t: 20 + VELOCITY_WINDOW_MS + 50 }])).toBe(0)
  })

  it('is 0 when no time passed', () => {
    expect(velocity([{ y: 0, t: 10 }, { y: 50, t: 10 }])).toBe(0)
  })
})
