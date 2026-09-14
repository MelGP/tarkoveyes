/*
 * bosses, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import {
  allPois,
  bossCatalog,
  bossSpawnRates,
  currentMapId,
  data,
  floor,
  mapDefinition
} from './state.js';

import { itemModeName } from './items-view.js';
import { $, el, svg, uiIcon } from './dom.js';
import { markerScale, point } from './geometry.js';
import { floorFor } from './floors.js';

export function bossZones() {
  return allPois.filter(poi => poi.kind === 'boss-zone' && poi.bossName);
}

export function bossGroups() {
  const scale = markerScale(),
    cell = Math.max(18, 70 * scale),
    groups = new Map();
  for (const zone of bossZones()) {
    if (floorFor(zone.position) !== floor) continue;
    const projected = point(zone.position),
      // One face per boss per neighbourhood: Icebreaker has forty zones and a
      // portrait on each would bury the ship.
      key = [zone.bossName, Math.floor(projected.x / cell), Math.floor(projected.y / cell)].join(
        ':'
      ),
      group = groups.get(key);
    if (group) group.zones.push(zone);
    else groups.set(key, { boss: zone.bossName, projected, zones: [zone] });
  }
  return [...groups.values()];
}
// The published rate depends on the mode: Reshala is 60% in PvP and 75% in PvE,
// and the Lighthouse Rogues jump from 50-90% to a flat 100%. The zone POIs carry
// a single snapshot, so the per-mode table wins wherever it has an entry.

// The published rate depends on the mode: Reshala is 60% in PvP and 75% in PvE,
// and the Lighthouse Rogues jump from 50-90% to a flat 100%. The zone POIs carry
// a single snapshot, so the per-mode table wins wherever it has an entry.
export function bossChance(zones) {
  const table = bossSpawnRates?.modes?.[data.mode]?.[currentMapId];
  let best = 0;
  for (const zone of zones) {
    const published = table?.[zone.bossId];
    best = Math.max(best, typeof published === 'number' ? published : zone.spawnChance || 0);
  }
  return best > 0 ? Math.round(best * 100) + '% chance' : null;
}

export function bossRateNote() {
  if (!bossSpawnRates) return null;
  if (data.mode === 'seasonal' && bossSpawnRates.seasonalSource === 'pvp')
    return 'Seasonal rates are not published, so this is the PvP figure.';
  return 'Rate for the ' + itemModeName() + ' mode.';
}

export function showBoss(group) {
  const pop = $('map-popup');
  pop.replaceChildren();
  const close = el('button', 'icon-only popup-close');
  close.append(uiIcon('close'));
  close.setAttribute('aria-label', 'Close boss');
  close.onclick = () => (pop.hidden = true);
  const portrait = bossCatalog[group.boss];
  const head = el('div', 'boss-popup-head');
  if (portrait) {
    const image = el('img', 'boss-popup-portrait');
    image.src = portrait.image;
    image.alt = '';
    image.onerror = () => image.remove();
    head.append(image);
  }
  head.append(el('strong', '', group.boss));
  pop.append(close, el('span', 'eyebrow', 'BOSS SPAWN'), head);
  const chance = bossChance(group.zones);
  if (chance) pop.append(el('p', 'door-note', 'Spawns here with a ' + chance + '.'));
  const rateNote = bossRateNote();
  if (chance && rateNote) pop.append(el('small', 'door-note', rateNote));
  const places = [...new Set(group.zones.map(zone => zone.name).filter(Boolean))];
  if (places.length) pop.append(el('p', 'door-note', places.join(' · ')));
  pop.append(
    el(
      'small',
      'door-note',
      group.zones.length +
        ' spawn zone' +
        (group.zones.length === 1 ? '' : 's') +
        ' here · from the bundled tarkov.dev map data'
    )
  );
  pop.hidden = false;
}

export function renderBosses() {
  const layer = $('boss-markers');
  if (!layer) return;
  layer.replaceChildren();
  if (!mapDefinition || !$('layer-bosses')?.checked) return;
  const scale = markerScale();
  for (const group of bossGroups()) {
    const portrait = bossCatalog[group.boss],
      size = 26 * scale,
      chance = bossChance(group.zones),
      g = svg('g', {
        class: 'map-marker boss-marker',
        tabindex: '0',
        role: 'button',
        'aria-label': group.boss + ' spawn' + (chance ? ' · ' + chance : '')
      });
    if (portrait)
      g.append(
        svg('image', {
          href: portrait.image,
          x: group.projected.x - size / 2,
          y: group.projected.y - size / 2,
          width: size,
          height: size,
          preserveAspectRatio: 'xMidYMid slice'
        })
      );
    g.append(
      svg('rect', {
        x: group.projected.x - size / 2,
        y: group.projected.y - size / 2,
        width: size,
        height: size,
        rx: 5 * scale,
        fill: portrait ? 'none' : '#141a1c',
        stroke: '#e59789',
        'stroke-width': 1.5 * scale
      })
    );
    const caption = svg('title');
    caption.textContent = group.boss + (chance ? ' spawns here · ' + chance : ' spawns here');
    g.append(caption);
    g.onclick = event => {
      event.stopPropagation();
      showBoss(group);
    };
    g.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showBoss(group);
      }
    };
    layer.append(g);
  }
}
