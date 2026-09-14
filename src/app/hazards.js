/*
 * hazards, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { allPois, currentMapId, floor, mapDefinition } from './state.js';
import { hazardKinds } from './vocabulary.js';

import { $, svg } from './dom.js';
import { point } from './geometry.js';
import { mapName } from './quest-state.js';
import { setLayerCount } from './map-layers.js';
import { floorFor } from './floors.js';

export function hazardsOfType(type) {
  return allPois.filter(poi => poi.kind === 'hazard' && (poi.hazardType || 'hazard') === type);
}

export function renderHazards() {
  const layer = $('hazards');
  if (!layer) return;
  layer.replaceChildren();
  if (!mapDefinition) return;
  for (const kind of hazardKinds) {
    if (!$(kind.control)?.checked) continue;
    for (const zone of hazardsOfType(kind.type)) {
      if (floorFor(zone.position) !== floor) continue;
      const outline = (zone.outline || []).map(corner => point(corner));
      let shape;
      if (outline.length > 2) {
        shape = svg('polygon', {
          points: outline.map(corner => corner.x + ',' + corner.y).join(' ')
        });
      } else {
        const centre = point(zone.position);
        shape = svg('circle', { cx: centre.x, cy: centre.y, r: 6 });
      }
      shape.setAttribute('class', 'hazard-zone hazard-' + kind.type);
      const caption = svg('title');
      caption.textContent = zone.name || kind.label;
      shape.append(caption);
      layer.append(shape);
    }
  }
}

export function updateHazardCounts() {
  let total = 0;
  for (const kind of hazardKinds) {
    const zones = hazardsOfType(kind.type).length;
    total += zones;
    const input = $(kind.control),
      row = input?.closest('label');
    if (input) input.disabled = zones === 0;
    if (row) row.hidden = zones === 0;
    setLayerCount('hazard-' + kind.type + '-count', zones);
  }
  const group = $('hazard-group');
  if (group) {
    group.hidden = total === 0;
    if (!total) group.open = false;
  }
  setLayerCount('hazard-count', total);
  const note = $('hazard-note');
  if (note)
    note.textContent = total
      ? total +
        ' zone' +
        (total === 1 ? '' : 's') +
        ' on ' +
        mapName(currentMapId) +
        ', from the bundled tarkov.dev map data. Drawn where that data places them.'
      : '';
}
