/*
 * The loot layer.
 *
 * Every container and loose pile on the map, the cache that keeps their
 * projections between redraws, the two popups, and the availability of the
 * layer switches.
 *
 * It imports from app.js and app.js imports four things back. The cycle is
 * safe because nothing is used while the modules evaluate.
 */
import {
  H,
  W,
  assignLootRenderTimer,
  assignView,
  currentMapId,
  floor,
  lootData,
  lootRenderTimer,
  mapDefinition,
  view
} from './state.js';
import { containerLayers } from './vocabulary.js';
import { looseLayers, price } from './app.js';
import { $, el, svg, uiIcon } from './dom.js';
import { centeredView, markerScale, point } from './geometry.js';
import { source } from './quest-state.js';
import { popupClose, scheduleDeclutter } from './markers.js';
import { setLayerCount } from './map-layers.js';
import { floorFor, floorName } from './floors.js';
import { setView } from './view.js';

/* The loot layer is the expensive half of a rebuild - 10.3ms of 23.6 on
 * Streets with everything switched on - and almost none of that work changes
 * between rebuilds. `lootEntries()` walked every container and every loose
 * pile, allocating an object each, and `renderLoot()` then projected each
 * position and worked out its floor, on every zoom settle and every layer
 * toggle.
 *
 * What it depends on is the map's loot document and which layer boxes are
 * ticked. Neither the projection nor the floor depends on where you are
 * looking or which floor you are on, so both are worked out once and kept.
 * The view still decides what is culled and how things cluster, which is the
 * part that genuinely has to be redone.
 */
export let lootCache = null;

export function lootEntries() {
  if (!lootData) return [];
  const containers = new Set(
      containerLayers.filter(([, id]) => $(id)?.checked).map(([key]) => key)
    ),
    loose = new Set(looseLayers.filter(([, id]) => $(id)?.checked).map(([key]) => key)),
    key = currentMapId + '|' + [...containers].sort().join(',') + '|' + [...loose].sort().join(',');
  if (lootCache && lootCache.key === key && lootCache.source === lootData) return lootCache.entries;
  const entries = [];
  for (const [x, y, z, type] of lootData.containers || []) {
    const category = lootData.containerTypes?.[type]?.category || 'caches';
    if (containers.has(category))
      entries.push({ kind: 'container', position: { x, y, z }, type, category });
  }
  for (const [x, y, z, items, categories = []] of lootData.loose || []) {
    const matching = (items || []).filter(id =>
      (lootData.items?.[id]?.categoryKeys || [lootData.items?.[id]?.categoryKey]).some(key =>
        loose.has(key)
      )
    );
    if (matching.length)
      entries.push({
        kind: 'loose',
        position: { x, y, z },
        items: matching,
        category:
          categories.find(key => loose.has(key)) ||
          lootData.items?.[matching[0]]?.categoryKey ||
          'other'
      });
  }
  /* Only worth keeping once the map is loaded enough to project against -
     caching a projection made without a definition would outlive the mistake. */
  if (mapDefinition) {
    for (const entry of entries) {
      entry.projected = point(entry.position);
      entry.itemFloor = floorFor(entry.position);
    }
    lootCache = { key, source: lootData, entries };
  }
  return entries;
}

export function lootMarkerAsset(entry) {
  if (entry.kind === 'container')
    return (
      'assets/loot/containers/' +
      (lootData.containerTypes?.[entry.type]?.icon || 'container_wooden-crate.png')
    );
  if (entry.items?.length === 1 && lootData.items?.[entry.items[0]])
    return 'assets/loot/items/' + entry.items[0] + '.webp';
  return 'assets/loot/categories/' + (lootData.categories?.[entry.category]?.icon || 'other.webp');
}

export function lootMarkerLabel(entry) {
  if (entry.kind === 'container')
    return lootData.containerTypes?.[entry.type]?.label || entry.type.replaceAll('-', ' ');
  const items = (entry.items || []).map(id => lootData.items?.[id]?.name).filter(Boolean);
  return items.length === 1 ? items[0] : items.length + ' possible loose-loot items';
}

export function showLoot(entry) {
  const pop = $('map-popup');
  pop.replaceChildren();
  pop.append(
    popupClose('Close loot details'),
    el('span', 'eyebrow', entry.kind === 'container' ? 'LOOT CONTAINER' : 'LOOSE LOOT'),
    el('strong', '', lootMarkerLabel(entry))
  );
  if (entry.kind === 'container') {
    const icon = el('img', 'loot-popup-icon');
    icon.src = lootMarkerAsset(entry);
    icon.alt = '';
    pop.append(
      icon,
      el(
        'small',
        '',
        floorName(floorFor(entry.position)) + ' · elevation ' + entry.position.y.toFixed(1) + ' m'
      ),
      el(
        'small',
        '',
        'Known searchable-container location. Its contents are randomized for each raid.'
      )
    );
  } else {
    const list = el('div', 'loot-popup-list');
    for (const id of entry.items || []) {
      const item = lootData.items?.[id];
      if (!item) continue;
      const row = el('div', 'loot-popup-item'),
        icon = el('img', '');
      icon.src = 'assets/loot/items/' + id + '.webp';
      icon.alt = '';
      const copy = el('span', '');
      copy.append(
        el('strong', '', item.name),
        el('small', '', item.category + (item.value ? ' · up to ' + price(item.value) : ''))
      );
      row.append(icon, copy);
      list.append(row);
    }
    pop.append(
      list,
      el(
        'small',
        '',
        floorName(floorFor(entry.position)) + ' · possible spawn, not guaranteed in this raid.'
      )
    );
  }
  pop.hidden = false;
}

export function showLootCluster(entries) {
  const pop = $('map-popup'),
    containers = entries.filter(entry => entry.kind === 'container').length,
    loose = entries.length - containers;
  pop.replaceChildren();
  pop.append(
    popupClose('Close loot cluster'),
    el('span', 'eyebrow', 'LOOT CLUSTER'),
    el('strong', '', entries.length + ' known loot points')
  );
  const summary = [
    containers && containers + ' container' + (containers === 1 ? '' : 's'),
    loose && loose + ' loose-loot point' + (loose === 1 ? '' : 's')
  ]
    .filter(Boolean)
    .join(' · ');
  pop.append(el('small', '', summary));
  const action = el('button', 'loot-zoom-button');
  action.append(uiIcon('search'), el('span', '', 'Zoom into points'));
  action.onclick = () => {
    const pts = entries.map(entry => point(entry.position)),
      center = {
        x: pts.reduce((n, p) => n + p.x, 0) / pts.length,
        y: pts.reduce((n, p) => n + p.y, 0) / pts.length
      },
      nextWidth = Math.max(60, view.w * 0.52);
    assignView(centeredView(center, nextWidth, (nextWidth * H) / W));
    pop.hidden = true;
    setView();
  };
  pop.append(action);
  pop.hidden = false;
}

export function renderLoot() {
  const layer = $('loot-markers');
  if (!layer) return;
  layer.replaceChildren();
  const entries = lootEntries();
  if (!entries.length || !mapDefinition) return;
  const scale = markerScale(),
    cellSize = Math.max(14, 58 * scale),
    padding = 34 * scale,
    groups = new Map();
  for (const entry of entries) {
    if ((entry.itemFloor ?? floorFor(entry.position)) !== floor) continue;
    const projected = entry.projected || point(entry.position);
    if (
      projected.x < view.x - padding ||
      projected.x > view.x + view.w + padding ||
      projected.y < view.y - padding ||
      projected.y > view.y + view.h + padding
    )
      continue;
    const key = Math.floor(projected.x / cellSize) + ':' + Math.floor(projected.y / cellSize),
      group = groups.get(key);
    if (group) group.entries.push(entry);
    else groups.set(key, { entries: [entry], projected });
  }
  for (const group of groups.values()) {
    const entriesHere = group.entries;
    /* The projection is cached on the entry - that is what lootCache is for,
       and the cull loop above already reads it. Re-projecting here, once per
       axis, was 6.5ms of a 9ms render on Streets: 2311 entries, 74 clusters,
       about 4600 projections nothing needed. One pass, cache first. */
    let position = group.projected;
    if (entriesHere.length > 1) {
      let sumX = 0,
        sumY = 0;
      for (const entry of entriesHere) {
        const projected = entry.projected || point(entry.position);
        sumX += projected.x;
        sumY += projected.y;
      }
      position = { x: sumX / entriesHere.length, y: sumY / entriesHere.length };
    }
    const label =
        entriesHere.length === 1
          ? lootMarkerLabel(entriesHere[0])
          : entriesHere.length + ' nearby loot points',
      g = svg('g', {
        transform: `translate(${position.x} ${position.y}) scale(${scale})`,
        class: 'map-marker loot-map-marker',
        tabindex: '0',
        role: 'button',
        'aria-label': label
      });
    if (entriesHere.length > 1) {
      g.append(
        svg('circle', {
          r: 12,
          fill: '#11191b',
          'fill-opacity': '.94',
          stroke: '#d5aa61',
          'stroke-width': 1.4
        })
      );
      const number = svg('text', {
        y: 3.2,
        fill: '#f0c97f',
        'font-size': entriesHere.length > 99 ? 6.5 : 8,
        'font-weight': 800,
        'text-anchor': 'middle'
      });
      number.textContent = entriesHere.length;
      g.append(number);
    } else {
      g.append(
        svg('circle', {
          r: 12,
          fill: '#101719',
          'fill-opacity': '.88',
          stroke: entriesHere[0].kind === 'container' ? '#8fbca6' : '#d6ad68',
          'stroke-width': 1
        })
      );
      g.append(
        svg('image', {
          x: -9.5,
          y: -9.5,
          width: 19,
          height: 19,
          href: lootMarkerAsset(entriesHere[0]),
          preserveAspectRatio: 'xMidYMid meet'
        })
      );
    }
    const title = svg('title');
    title.textContent = label;
    g.append(title);
    const open = () =>
      entriesHere.length === 1 ? showLoot(entriesHere[0]) : showLootCluster(entriesHere);
    g.onclick = event => {
      event.stopPropagation();
      open();
    };
    g.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    };
    layer.append(g);
  }
}

export function scheduleLootRender() {
  clearTimeout(lootRenderTimer);
  assignLootRenderTimer(
    setTimeout(() => {
      renderLoot();
      scheduleDeclutter();
    }, 90)
  );
}

export function setLootLayerAvailability(controlId, countId, count) {
  const input = $(controlId),
    row = input?.closest('label');
  if (input) input.disabled = count === 0;
  if (row) row.hidden = count === 0;
  setLayerCount(countId, count);
}
