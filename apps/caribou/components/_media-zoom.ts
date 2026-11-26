// Zoom math for the media viewer's image. Pure functions, no DOM.
//
// The image sits in a frame (the stage) that clips it. Its transform is
// `translate(x, y) scale(scale)` with the origin at the frame's center, so
// a point `p` of the image, measured from the center, shows at
// `(x, y) + scale * p` from the center. Every point here is in CSS pixels
// from the frame's center.

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

export const MIN_SCALE = 1
export const MAX_SCALE = 4
export const DOUBLE_TAP_SCALE = 2.5
// One `+` or `-` key press.
export const KEY_STEP = 1.5

export const IDENTITY: Zoom = Object.freeze({ scale: 1, x: 0, y: 0 })

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

// The image always covers its frame: an edge may come to the frame's edge,
// never inside it. At 1x that leaves no room, so the image is centered.
export function clampPan(zoom: Zoom, frame: Size): Zoom {
  const scale = clampScale(zoom.scale)
  const maxX = ((scale - 1) * frame.width) / 2
  const maxY = ((scale - 1) * frame.height) / 2
  return {
    scale,
    x: clampAbs(zoom.x, maxX),
    y: clampAbs(zoom.y, maxY),
  }
}

// Zoom to `scale` and keep the image point under `at` where it is, as far
// as the frame allows.
export function zoomAt(zoom: Zoom, scale: number, at: Point, frame: Size): Zoom {
  const next = clampScale(scale)
  const ratio = next / zoom.scale
  return clampPan({
    scale: next,
    x: at.x - (at.x - zoom.x) * ratio,
    y: at.y - (at.y - zoom.y) * ratio,
  }, frame)
}

// Move by `dx, dy`, as far as the frame allows.
export function panBy(zoom: Zoom, dx: number, dy: number, frame: Size): Zoom {
  return clampPan({ scale: zoom.scale, x: zoom.x + dx, y: zoom.y + dy }, frame)
}

// A double tap zooms in on the tapped point; on a zoomed image it goes back
// to 1x.
export function doubleTap(zoom: Zoom, at: Point, frame: Size): Zoom {
  return isZoomed(zoom) ? IDENTITY : zoomAt(zoom, DOUBLE_TAP_SCALE, at, frame)
}

// Two pointers: scale by how far apart they are now against the start, about
// the start midpoint, and follow the midpoint as it moves.
export function pinch(
  start: Zoom,
  startDistance: number,
  startMid: Point,
  distance: number,
  mid: Point,
  frame: Size,
): Zoom {
  const scale = startDistance > 0 ? start.scale * (distance / startDistance) : start.scale
  const zoomed = zoomAt(start, scale, startMid, frame)
  return panBy(zoomed, mid.x - startMid.x, mid.y - startMid.y, frame)
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
