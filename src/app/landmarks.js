/*
 * landmarks, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { allPois, currentMapId } from './state.js';
import { internalLabel, landmarkKey, landmarksByMap, vagueLabel } from './vocabulary.js';

import { $, svg } from './dom.js';
import { markerScale, point } from './geometry.js';
import { floorLabel } from './map-layers.js';

export function derivedLandmarks() {
  if (!allPois.length) return [];
  // Curated names are matched loosely, so a hand-placed NEW GAS also covers the
  // catalogue name New Gas Station. Derived names are matched exactly: Sawmill and
  // Old Sawmill are two different places in Woods and both belong on the map.
  const curated = (landmarksByMap[currentMapId] || []).map(item => landmarkKey(item[0]));
  const taken = new Set();
  const out = [];
  for (const poi of allPois) {
    let label = null,
      boss = null,
      detail = null;
    if (poi.kind === 'boss-zone') {
      label = poi.name.includes('·') ? poi.name.split('·').pop().trim() : null;
      boss = poi.bossName;
      if (label && poi.bossName)
        detail =
          poi.bossName +
          ' spawns here' +
          (poi.spawnChance ? ' · ' + Math.round(poi.spawnChance * 100) + '% chance' : '');
    } else if (poi.kind === 'btr') {
      label = poi.name;
      detail = 'BTR stop';
    }
    if (
      !label ||
      label.length < 3 ||
      internalLabel.test(label) ||
      vagueLabel.test(label) ||
      floorLabel.test(label)
    )
      continue;
    const key = landmarkKey(label);
    if (taken.has(key)) continue;
    if (curated.some(name => name.includes(key) || key.includes(name))) continue;
    taken.add(key);
    out.push({ label: label.toUpperCase(), position: poi.position, detail, boss });
  }
  return out;
}

export function landmarkText(name, position, detail) {
  const scale = markerScale(),
    p = point(position),
    node = svg('text', {
      x: p.x,
      y: p.y - 15 * scale,
      'text-anchor': 'middle',
      fill: '#e2e9d7',
      stroke: '#183034',
      'stroke-width': 3 * scale,
      'paint-order': 'stroke',
      'font-size': 9 * scale,
      'font-family': 'Consolas,monospace',
      'letter-spacing': 0.7 * scale
    });
  node.textContent = name;
  if (detail) {
    const caption = svg('title');
    caption.textContent = detail;
    node.append(caption);
  }
  return node;
}
// Boss spawns. These were first drawn as part of the landmark labels, which hid
// them wherever the label lost: Reshala vanished from the Customs dorms because
// a hand-placed DORMS label won the name, and Tagilla never appeared on Factory
// at all because his zone is called "Any scav spawn". The portraits belong to
// the zones, not to the captions, so they get their own layer.

export function renderLandmarks() {
  $('landmarks').replaceChildren();
  if (!$('layer-labels').checked) return;
  const scale = markerScale();
  for (const [name, x, z, piece, tone] of landmarksByMap[currentMapId] || []) {
    const p = point({ x, z });
    if (!piece) {
      $('landmarks').append(landmarkText(name, { x, z }));
      continue;
    }
    const width = Math.max(78, name.length * 5.2 + 30),
      light = tone === 'white',
      g = svg('g', {
        transform: `translate(${p.x} ${p.y}) scale(${scale})`,
        class: 'chess-landmark',
        'aria-label': name
      });
    g.append(
      svg('rect', {
        x: -width / 2,
        y: -10,
        width,
        height: 20,
        rx: 5,
        fill: '#0b1719',
        'fill-opacity': 0.88,
        stroke: light ? '#dfe4dc' : '#91a09c',
        'stroke-width': 1
      })
    );
    g.append(
      svg('circle', {
        cx: -width / 2 + 11,
        cy: 0,
        r: 7,
        fill: light ? '#e7ebe3' : '#182326',
        stroke: light ? '#69736f' : '#d2d9d4',
        'stroke-width': 1.2
      })
    );
    const icon = svg('text', {
      x: -width / 2 + 11,
      y: 4,
      'text-anchor': 'middle',
      fill: light ? '#172023' : '#edf0ea',
      'font-size': 12,
      'font-family': 'Segoe UI Symbol,serif'
    });
    icon.textContent = piece;
    g.append(icon);
    const label = svg('text', {
      x: -width / 2 + 23,
      y: 3.4,
      fill: '#edf0ea',
      'font-size': 8.2,
      'font-family': 'Consolas,monospace',
      'font-weight': 700,
      'letter-spacing': 0.45
    });
    label.textContent = name;
    g.append(label);
    $('landmarks').append(g);
  }
  for (const place of derivedLandmarks())
    $('landmarks').append(landmarkText(place.label, place.position, place.detail));
}
