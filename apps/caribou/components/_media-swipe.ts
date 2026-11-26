// Swipe to dismiss in the media viewer: at 1x a drag moves the image up or
// down with the pointer, the backdrop fades with the distance, and on
// release the viewer closes or the image springs back. Pure functions, so
// every threshold is tested on its own (`__tests__/media-swipe.test.ts`).
//
// Distances are in CSS pixels, from where the drag started; a positive `dy`
// is down. `height` is the stage's height: the further the image goes in
// it, the more the viewer has given way.

// Past this share of the stage's height the release closes the viewer.
export const CLOSE_AT = 0.2
// The backdrop is gone at this share of the height.
export const FADE_OUT_AT = 0.5
// A release this fast (px per ms) in the drag's direction closes the viewer
// at any distance past the tap slop: a flick.
export const FLICK = 0.5
// A flick needs this much travel, so a tap that jitters is not one.
export const FLICK_MIN_PX = 10
// The velocity is read over the drag's last moments only.
export const VELOCITY_WINDOW_MS = 100

/** How far the drag has gone, 0 to 1, as a share of the stage's height. */
export function progress(dy: number, height: number): number {
  if (!(height > 0) || !Number.isFinite(dy)) return 0
  return Math.min(1, Math.abs(dy) / height)
}

/** The backdrop's opacity for a drag: 1 at rest, 0 at FADE_OUT_AT. */
export function fade(dy: number, height: number): number {
  return Math.max(0, 1 - progress(dy, height) / FADE_OUT_AT)
}

/**
 * Whether a release closes the viewer. `velocity` is px per ms, positive
 * down. A flick in the drag's direction closes it; past CLOSE_AT it closes
 * unless the pointer is flicking back toward the start. With no stage
 * there is nothing to swipe.
 */
export function shouldClose(dy: number, velocity: number, height: number): boolean {
  if (!(height > 0) || !Number.isFinite(dy) || dy === 0) return false
  const v = Number.isFinite(velocity) ? velocity : 0
  const along = Math.sign(dy) * v
  if (along >= FLICK && Math.abs(dy) >= FLICK_MIN_PX) return true
  if (along <= -FLICK) return false
  return progress(dy, height) >= CLOSE_AT
}

export interface Sample { y: number; t: number }

/**
 * The pointer's speed in px per ms, positive down: over the last stroke,
 * no further back than VELOCITY_WINDOW_MS before the last sample. A stroke
 * ends where the pointer turned around, so a quick flick back at the end
 * reads as a move back, not as the slower average of the whole window. 0
 * with fewer than two samples in that time, or no time between them.
 */
export function velocity(samples: readonly Sample[]): number {
  const last = samples.at(-1)
  if (!last) return 0
  let first = last
  let direction = 0
  for (let i = samples.length - 2; i >= 0; i--) {
    const s = samples[i]!
    if (last.t - s.t > VELOCITY_WINDOW_MS) break
    const step = Math.sign(first.y - s.y)
    if (direction === 0) direction = step
    else if (step !== 0 && step !== direction) break
    first = s
  }
  const dt = last.t - first.t
  return dt > 0 ? (last.y - first.y) / dt : 0
}
