/*
 * floors, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { renderBosses } from './bosses.js';
import { renderBtr } from './btr.js';
import { $ } from './dom.js';
import { renderDoors, renderKeycardDoors, renderSwitches } from './doors.js';
import { renderHazards } from './hazards.js';
import { renderLoot } from './loot.js';
import { renderMarkers } from './markers.js';
import { assignFloor, mapDefinition } from './state.js';
import { renderBattlepass } from './app.js';

export function floorName(id) {
  return (
    mapDefinition.floors.find(item => item.id === id)?.name ||
    (mapDefinition.baseFloor?.id === id ? mapDefinition.baseFloor.name : id.replaceAll('_', ' '))
  );
}

export function baseFloor() {
  if (mapDefinition.baseAsset.type === 'image') {
    const first = mapDefinition.floors.find(item => item.asset);
    if (first) return first.id;
  }
  return mapDefinition.baseFloor?.id || mapDefinition.baseAsset.baseLayer || 'base';
}

export function floorFor(p) {
  for (const f of [...mapDefinition.floors].reverse()) {
    if (!f.svgLayer && !f.asset) continue;
    for (const e of f.extents || [])
      if (p.y >= e.height[0] && p.y < e.height[1]) {
        for (const b of e.bounds || []) {
          const [a, c] = b;
          if (
            p.x >= Math.min(a[0], c[0]) &&
            p.x <= Math.max(a[0], c[0]) &&
            p.z >= Math.min(a[1], c[1]) &&
            p.z <= Math.max(a[1], c[1])
          )
            return f.id;
        }
      }
  }
  return baseFloor();
}

export function applyFloor(value) {
  assignFloor(value);
  $('floor').value = value;
  $('map-popup').hidden = true;
  if (mapDefinition.baseAsset.type === 'image') {
    const asset =
      mapDefinition.floors.find(item => item.id === value)?.asset || mapDefinition.baseAsset;
    const image = $('artwork').querySelector('image');
    if (image) image.setAttribute('href', 'assets' + asset.path);
  } else {
    const baseLayer = mapDefinition.baseAsset.baseLayer;
    for (const f of mapDefinition.floors.filter(item => item.svgLayer)) {
      const layer =
        $('artwork').querySelector('[data-layer="' + f.svgLayer + '"]') ||
        $('artwork').querySelector('[id="' + f.svgLayer + '"]');
      if (layer) layer.style.display = f.id === value ? '' : 'none';
    }
    const base =
      $('artwork').querySelector('[data-layer="' + baseLayer + '"]') ||
      $('artwork').querySelector('[id="' + baseLayer + '"]');
    if (base) {
      base.style.display = '';
      base.style.opacity = value === baseFloor() ? '1' : '.33';
    }
  }
  renderMarkers();
  renderKeycardDoors();
  renderDoors();
  renderSwitches();
  renderBtr();
  renderBosses();
  renderLoot();
  renderBattlepass();
  renderHazards();
}
