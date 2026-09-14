/*
 * command-palette, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { openDashboard } from './dashboard.js';
import { renderLoot, showLoot } from './loot.js';
import { ensureRaidData } from './my-raid.js';
import {
  allPois,
  assignCommandIndex,
  assignCommandMatches,
  commandIndex,
  commandMatches,
  currentMapId,
  lootData,
  mapDefinitions,
  mapFocus,
  quests
} from './state.js';
import { containerLayers, landmarksByMap } from './vocabulary.js';
import { connection, looseLayers, price, selectQuest } from './app.js';
import { openItems, searchItems } from './items-view.js';
import { $, el, toast, uiIcon } from './dom.js';
import { mapName, objectivePoints, questMaps, status } from './quest-state.js';
import { applyLayerPreset, renderAllMapLayers, saveLayers } from './map-layers.js';
import { focusMapPosition, focusQuest, setMapFocus } from './view.js';
import { switchMap } from './map-load.js';

export function revealLooseSearch(position, id, category, label) {
  const control = looseLayers.find(([key]) => key === category)?.[1];
  if (control) $(control).checked = true;
  renderLoot();
  saveLayers();
  focusMapPosition(position, label);
  showLoot({ kind: 'loose', position, items: [id], category });
}

export function revealContainerSearch(position, type, category, label) {
  const control = containerLayers.find(([key]) => key === category)?.[1];
  if (control) $(control).checked = true;
  renderLoot();
  saveLayers();
  focusMapPosition(position, label);
  showLoot({ kind: 'container', position, type, category });
}

export function revealMapSearch(position, label, layer) {
  $(layer).checked = true;
  renderAllMapLayers();
  saveLayers();
  focusMapPosition(position, label);
}

export function commandEntries(query = '') {
  const term = query.trim().toLowerCase(),
    entries = [],
    add = (type, label, detail, icon, run, weight = 50) =>
      entries.push({ type, label, detail, icon, run, weight });
  add(
    'ACTION',
    'Update quest progress from logs',
    'Read every Tarkov log session',
    'refresh',
    () => $('refresh-logs').click(),
    0
  );
  add(
    'ACTION',
    'Scan the Tasks screen',
    'Review objective counters locally',
    'scan',
    () => $('scan-tasks').click(),
    1
  );
  add(
    'ACTION',
    'Open item price tracker',
    'Inventory scan, search and prices',
    'tag',
    () => openItems(),
    2
  );
  add(
    'ACTION',
    'Open progress dashboard',
    'Profile totals and raid history',
    'dashboard',
    () => openDashboard(),
    3
  );
  add(
    'ACTION',
    'Connection and backups',
    'Folders, live tracking and local backups',
    'settings',
    connection,
    4
  );
  add(
    'ACTION',
    mapFocus ? 'Exit focused map' : 'Focus the map',
    'Use the whole window for the current map',
    'maximize',
    () => setMapFocus(!mapFocus),
    5
  );
  add(
    'ACTION',
    'Valuables+ map view',
    'High-value loot and Battle Pass documents',
    'layers',
    () => applyLayerPreset('valuables'),
    6
  );
  for (const map of mapDefinitions)
    add(
      'MAP',
      map.displayName,
      'Open location and its quests',
      'map',
      () => switchMap(map.id, { filterQuests: true }),
      15
    );
  for (const q of quests)
    add(
      'QUEST',
      q.name,
      q.traderName + ' · ' + questMaps(q) + ' · ' + status(q),
      'route',
      async () => {
        const target = q.mapIds.includes(currentMapId)
          ? currentMapId
          : q.primaryMapId || q.mapIds[0];
        if (target && target !== currentMapId) await switchMap(target, { filterQuests: true });
        selectQuest(q);
        if (objectivePoints(q).length) focusQuest(q);
      },
      25
    );
  for (const [mapId, landmarks] of Object.entries(landmarksByMap))
    for (const [name, x, z] of landmarks)
      add(
        'LANDMARK',
        name,
        mapName(mapId),
        'landmark',
        async () => {
          if (mapId !== currentMapId) await switchMap(mapId, { filterQuests: true });
          revealMapSearch({ x, y: 0, z }, name, 'layer-labels');
        },
        10
      );
  for (const poi of allPois.filter(item => item.kind === 'extract' || item.kind === 'transit')) {
    const layer =
      poi.kind === 'transit'
        ? 'layer-transit'
        : poi.category === 'extract-scav'
          ? 'layer-scav'
          : 'layer-extract';
    add(
      poi.kind === 'transit' ? 'TRANSIT' : 'EXTRACT',
      poi.name,
      mapName(currentMapId),
      'extract',
      () => revealMapSearch(poi.position, poi.name, layer),
      12
    );
  }
  for (const marker of ensureRaidData().customMarkers[currentMapId])
    add(
      'MARKER',
      marker.name,
      marker.note || mapName(currentMapId),
      'pin',
      () => revealMapSearch(marker.position, marker.name, 'layer-custom'),
      9
    );
  if (term.length >= 2 && lootData) {
    let matches = 0;
    for (const [x, y, z, type] of lootData.containers || []) {
      const meta = lootData.containerTypes?.[type],
        label = meta?.label || type.replaceAll('-', ' ');
      if (!label.toLowerCase().includes(term)) continue;
      const category = meta?.category || 'caches',
        position = { x, y, z };
      add(
        'LOOT',
        label,
        'Container · ' + mapName(currentMapId),
        'layers',
        () => revealContainerSearch(position, type, category, label),
        18
      );
      if (++matches >= 12) break;
    }
    for (const [x, y, z, ids] of lootData.loose || []) {
      for (const id of ids || []) {
        const item = lootData.items?.[id];
        if (!item?.name.toLowerCase().includes(term)) continue;
        const position = { x, y, z };
        add(
          'LOOT',
          item.name,
          (item.category || 'Loose loot') + (item.value ? ' · up to ' + price(item.value) : ''),
          'tag',
          () => revealLooseSearch(position, id, item.categoryKey, item.name),
          17
        );
        if (++matches >= 30) break;
      }
      if (matches >= 30) break;
    }
  }
  if (term.length >= 2)
    add(
      'ITEM',
      'Search prices for “' + query.trim() + '”',
      'Open the full item catalog',
      'tag',
      async () => {
        await openItems();
        $('item-search').value = query.trim();
        searchItems();
      },
      20
    );
  if (!term)
    return entries.filter(entry => entry.type === 'ACTION').sort((a, b) => a.weight - b.weight);
  const words = term.split(/\s+/).filter(Boolean);
  return entries
    .filter(entry =>
      words.every(word =>
        (entry.label + ' ' + entry.detail + ' ' + entry.type).toLowerCase().includes(word)
      )
    )
    .sort((a, b) => {
      const al = a.label.toLowerCase(),
        bl = b.label.toLowerCase(),
        as = al === term ? 0 : al.startsWith(term) ? 1 : al.includes(term) ? 2 : 3,
        bs = bl === term ? 0 : bl.startsWith(term) ? 1 : bl.includes(term) ? 2 : 3;
      return as - bs || a.weight - b.weight || al.localeCompare(bl);
    });
}

export function updateCommandSelection() {
  const buttons = [...$('command-results').querySelectorAll('.command-result')];
  buttons.forEach((button, index) => {
    const active = index === commandIndex;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-selected', String(active));
  });
  buttons[commandIndex]?.scrollIntoView({ block: 'nearest' });
}

export function runCommand(index = commandIndex) {
  const entry = commandMatches[index];
  if (!entry) return;
  $('command-dialog').close();
  Promise.resolve(entry.run()).catch(error =>
    toast('Could not open that result: ' + error.message, 'error')
  );
}

export function renderCommandResults(reset = false) {
  const root = $('command-results');
  assignCommandMatches(commandEntries($('command-search').value).slice(0, 12));
  if (reset) assignCommandIndex(0);
  else assignCommandIndex(Math.min(commandIndex, Math.max(0, commandMatches.length - 1)));
  root.replaceChildren();
  if (!commandMatches.length) {
    const empty = el('div', 'command-empty');
    empty.append(
      uiIcon('search'),
      el('strong', '', 'Nothing found'),
      el('small', '', 'Try a quest, map, extract, building or item name.')
    );
    root.append(empty);
    return;
  }
  commandMatches.forEach((entry, index) => {
    const button = el('button', 'command-result');
    button.type = 'button';
    button.setAttribute('role', 'option');
    const glyph = el('span', 'command-glyph');
    glyph.append(uiIcon(entry.icon));
    const copy = el('span', 'command-copy');
    copy.append(el('strong', '', entry.label), el('small', '', entry.detail));
    button.append(glyph, copy, el('span', 'command-type', entry.type));
    button.onmouseenter = () => {
      assignCommandIndex(index);
      updateCommandSelection();
    };
    button.onclick = () => runCommand(index);
    root.append(button);
  });
  updateCommandSelection();
}

export function openCommandPalette(seed = '') {
  const dialog = $('command-dialog'),
    input = $('command-search');
  if (!dialog.open) dialog.showModal();
  input.value = seed;
  renderCommandResults(true);
  requestAnimationFrame(() => input.focus());
}
