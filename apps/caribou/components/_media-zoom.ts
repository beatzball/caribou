// Zoom math for the media viewer's image. Pure functions, no DOM.
//
// The image sits centered in the stage, which clips it. Its transform is
// `translate(x, y) scale(scale)` with the origin at its center, so a point
// `p` of the image, measured from the center, shows at `(x, y) + scale * p`
// from the center. Every point here is in CSS pixels from the stage's
// center, which is the image's center at 1x.

export interface Zoom {
  scale: number
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

// The image's box at 1x, and the stage it zooms in.
export interface Bounds {
  image: Size
  stage: Size
}

export const MIN_SCALE = 1
export const MAX_SCALE = 4
export const DOUBLE_TAP_SCALE = 2.5
// One `+` or `-` key press.
export const KEY_STEP = 1.5
// One arrow key press, as a share of the stage.
export const PAN_STEP = 0.1

export const IDENTITY: Zoom = Object.freeze({ scale: 1, x: 0, y: 0 })

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

// Where the zoomed image is wider (or taller) than the stage, an edge may
// come to the stage's edge, never inside it. Where it still fits, it stays
// centered on that axis. At 1x the image fits, so it is centered.
export function clampPan(zoom: Zoom, b: Bounds): Zoom {
  const scale = clampScale(zoom.scale)
  const maxX = Math.max(0, (scale * b.image.width - b.stage.width) / 2)
  const maxY = Math.max(0, (scale * b.image.height - b.stage.height) / 2)
  return {
    scale,
    x: clampAbs(zoom.x, maxX),
    y: clampAbs(zoom.y, maxY),
  }
}

// Zoom to `scale` and keep the image point under `at` where it is, as far
// as the stage allows.
export function zoomAt(zoom: Zoom, scale: number, at: Point, b: Bounds): Zoom {
  const next = clampScale(scale)
  const ratio = next / zoom.scale
  return clampPan({
    scale: next,
    x: at.x - (at.x - zoom.x) * ratio,
    y: at.y - (at.y - zoom.y) * ratio,
  }, b)
}

// Move by `dx, dy`, as far as the stage allows.
export function panBy(zoom: Zoom, dx: number, dy: number, b: Bounds): Zoom {
  return clampPan({ scale: zoom.scale, x: zoom.x + dx, y: zoom.y + dy }, b)
}

// A double tap zooms in on the tapped point; on a zoomed image it goes back
// to 1x.
export function doubleTap(zoom: Zoom, at: Point, b: Bounds): Zoom {
  return isZoomed(zoom) ? IDENTITY : zoomAt(zoom, DOUBLE_TAP_SCALE, at, b)
}

// Two pointers: scale by how far apart they are now against the start, about
// the start midpoint, and follow the midpoint as it moves.
export function pinch(
  start: Zoom,
  startDistance: number,
  startMid: Point,
  distance: number,
  mid: Point,
  b: Bounds,
): Zoom {
  const scale = startDistance > 0 ? start.scale * (distance / startDistance) : start.scale
  const zoomed = zoomAt(start, scale, startMid, b)
  return panBy(zoomed, mid.x - startMid.x, mid.y - startMid.y, b)
}

// A wheel step with ctrl (or a trackpad pinch, which the browser sends as
// one). Deltas are in pixels; a big mouse notch is capped to one fair step.
export function wheelScale(scale: number, deltaY: number): number {
  const d = Math.max(-50, Math.min(50, deltaY))
  return clampScale(scale * Math.exp(-d / 100))
}

export function isZoomed(zoom: Zoom): boolean {
  return zoom.scale > MIN_SCALE
}

export function transformOf(zoom: Zoom): string {
  return isZoomed(zoom) ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` : ''
}

function clampAbs(v: number, max: number): number {
  if (!Number.isFinite(v)) return 0
  // `+ 0` turns -0 into 0.
  return Math.min(max, Math.max(-max, v)) + 0
}
