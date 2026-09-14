/*
 * geometry, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { $ } from './dom.js';
import { H, W, mapDefinition, view } from './state.js';

export function rotatedPoint(p, definition = mapDefinition) {
  const radians = ((definition.coordinateRotation || 0) * Math.PI) / 180,
    cos = Math.cos(radians),
    sin = Math.sin(radians);
  return { x: p.x * cos - p.z * sin, z: p.x * sin + p.z * cos };
}

export function projectedBounds(definition = mapDefinition) {
  const [[x1, z1], [x2, z2]] = definition.svgBounds || definition.bounds;
  const corners = [
    { x: x1, z: z1 },
    { x: x1, z: z2 },
    { x: x2, z: z1 },
    { x: x2, z: z2 }
  ].map(p => rotatedPoint(p, definition));
  return {
    minX: Math.min(...corners.map(p => p.x)),
    maxX: Math.max(...corners.map(p => p.x)),
    minZ: Math.min(...corners.map(p => p.z)),
    maxZ: Math.max(...corners.map(p => p.z))
  };
}

export function point(p) {
  const q = rotatedPoint(p),
    b = projectedBounds();
  return {
    x: ((q.x - b.minX) / (b.maxX - b.minX)) * W,
    y: ((b.maxZ - q.z) / (b.maxZ - b.minZ)) * H
  };
}

/* The measured box of `#map-svg`, kept until the element actually resizes.
 * makeMarker() asks for the scale once per marker, and reading geometry
 * between DOM writes forces a full re-layout of the SVG each time - 7.57ms of
 * a 7.7ms renderMarkers, by the sampling profiler. Appending markers cannot
 * change this box, and panning and zooming move `view`, not the element. */
export let mapSvgBox = null;

export function markerScale() {
  /* A zero box is not an answer, so it is never kept. Measured before anything
     is laid out - the window still hidden, the pane not yet shown - the rect
     is 0x0, and caching that made every marker scale(Infinity) and every label
     y="-Infinity" until something happened to resize the element. Chromium
     rejects those attributes one console error at a time and draws nothing.
     Re-measuring costs a layout only while the map genuinely has no size. */
  if (!mapSvgBox?.width) mapSvgBox = $('map-svg').getBoundingClientRect();
  if (!mapSvgBox.width || !mapSvgBox.height) return 1;
  return Math.max(view.w / mapSvgBox.width, view.h / mapSvgBox.height);
}
/* The one way to drop it. markerScale() and this live together wherever the
   cache does, so a module that only observes a resize never has to reach in. */

export function forgetMapSvgBox() {
  mapSvgBox = null;
}

/* Where the middle of the map actually is, as a fraction of the viewport.
 *
 * The rail and, when it is open, the quest brief lie over the left of the
 * map, so the geometric centre of the viewport is underneath them. Framing a
 * quest objective there put the one thing you asked to see behind the glass.
 * This returns the centre of the strip you can see, which is 0.5 again as soon
 * as nothing is covering anything - the narrow layouts included.
 */
export function visibleCentreFraction() {
  const viewport = $('map-viewport');
  if (!viewport) return 0.5;
  const frame = viewport.getBoundingClientRect();
  if (!frame.width) return 0.5;
  let covered = frame.left;
  for (const selector of ['.sidebar', '#details']) {
    const panel = document.querySelector(selector);
    if (!panel) continue;
    const style = getComputedStyle(panel);
    if (style.display === 'none' || style.visibility === 'hidden' || +style.opacity === 0) continue;
    const box = panel.getBoundingClientRect();
    // only panels lying over the map's left edge, not ones beside it
    if (box.left <= covered + 24 && box.right > covered) covered = box.right;
  }
  const middle = (covered + frame.right) / 2;
  const fraction = (middle - frame.left) / frame.width;
  return Math.min(Math.max(fraction, 0.5), 0.85);
}

export function centeredView(p, w = view.w, h = view.h) {
  const fx = visibleCentreFraction();
  return {
    x: w >= W ? (W - w) / 2 : Math.max(0, Math.min(W - w, p.x - w * fx)),
    y: h >= H ? (H - h) / 2 : Math.max(0, Math.min(H - h, p.y - h / 2)),
    w,
    h
  };
}
