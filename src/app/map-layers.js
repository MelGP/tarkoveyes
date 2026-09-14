/*
 * map-layers, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { markerScale, point } from './geometry.js';
import { bossZones, renderBosses } from './bosses.js';
import { btrStops } from './btr.js';
import { renderCustomMarkers } from './custom-markers.js';
import { derivedLandmarks, renderLandmarks } from './landmarks.js';
import { renderMarkers, scheduleDeclutter } from './markers.js';
import { ensureRaidData } from './my-raid.js';
import { renderLoot, setLootLayerAvailability } from './loot.js';
import {
  doorEntries,
  labDoorEntries,
  renderDoors,
  renderKeycardDoors,
  renderSwitches,
  switchEntries
} from './doors.js';
import { $, svg, toast } from './dom.js';
import { renderHazards, updateHazardCounts } from './hazards.js';

import { allPois, bridge, currentMapId, data, floor, lootData, pois } from './state.js';
import { containerLayers, hazardKinds, landmarksByMap } from './vocabulary.js';
import { looseLayers, renderBattlepass } from './app.js';
import { doneObjectivesOnMap } from './quest-state.js';

export function poiById(id) {
  return allPois.find(poi => poi.id === id) || null;
}

export const floorLabel = /^(first|second|third|fourth|ground)\s+(floor|level)$|^basement$/i;

export function renderExtractLabels() {
  $('extract-labels').replaceChildren();
  const scale = markerScale();
  for (const p of pois) {
    const pmcNames = $('layer-extract').checked && $('layer-pmc-extract-labels').checked,
      scavNames = $('layer-scav').checked && $('layer-scav-extract-labels').checked;
    let visible =
      p.category === 'transit'
        ? $('layer-transit').checked && $('layer-transit-labels').checked
        : p.category === 'extract-shared'
          ? pmcNames || scavNames
          : p.category === 'extract-scav'
            ? scavNames
            : p.category === 'extract-pmc'
              ? pmcNames
              : false;
    if (!visible) continue;
    const pt = point(p.position),
      color = p.category === 'transit' || p.category === 'extract-scav' ? '#9bc8dc' : '#b7ddc7';
    const t = svg('text', {
      x: pt.x,
      y: pt.y + 20 * scale,
      'text-anchor': 'middle',
      fill: color,
      stroke: '#112225',
      'stroke-width': 3 * scale,
      'paint-order': 'stroke',
      'font-size': 8 * scale,
      'font-family': 'Consolas,monospace',
      'letter-spacing': 0.35 * scale
    });
    t.textContent = p.name.toUpperCase();
    $('extract-labels').append(t);
  }
}

export function updateLayerChildren() {
  $('layer-pmc-extract-labels').disabled = !$('layer-extract').checked;
  $('layer-scav-extract-labels').disabled = !$('layer-scav').checked;
  $('layer-transit-labels').disabled = !$('layer-transit').checked;
  $('layer-lab-keycard-labels').disabled = !$('layer-lab-keycards').checked;
  /* The circuit is a way of reading the stops, so it follows them: with the
     stops off there is nothing for a line to join. */
  $('layer-btr-route').disabled = !$('layer-btr').checked;
}

export function updateMapSpecificLayers() {
  const labs = currentMapId === 'the-lab';
  $('layer-lab-keycards-row').hidden = !labs;
  $('layer-lab-keycard-labels-row').hidden = !labs;
}

export function setLayerCount(id, count) {
  const badge = $(id);
  badge.textContent = count > 1 ? count : '';
  badge.hidden = count <= 1;
}

export function updateLayerCounts() {
  const btrCount = $('btr-count');
  if (btrCount) {
    const total = btrStops().length;
    btrCount.textContent = total;
    btrCount.hidden = !total;
    /* Only two maps have a BTR, so on the other eleven the row hides itself
       rather than offering a layer that would draw nothing - the same thing
       the landmark checkbox does where there are no usable names. */
    const row = btrCount.closest('label');
    if (row) row.hidden = !total;
    const child = $('layer-btr-route-row');
    if (child) child.hidden = !total;
  }
  const doneCount = $('done-objective-count');
  if (doneCount) {
    const total = doneObjectivesOnMap();
    doneCount.textContent = total;
    doneCount.hidden = !total;
  }
  updateHazardCounts();
  renderBattlepass();
  const pmc = allPois.filter(
    p => p.kind === 'extract' && (p.category === 'extract-pmc' || p.category === 'extract-shared')
  ).length;
  const scav = allPois.filter(
    p => p.kind === 'extract' && (p.category === 'extract-scav' || p.category === 'extract-shared')
  ).length;
  const containerCount = lootData?.containers?.length || 0,
    looseCount = lootData?.loose?.length || 0;
  setLayerCount('extract-count', pmc);
  setLayerCount('scav-count', scav);
  setLayerCount('transit-count', allPois.filter(p => p.kind === 'transit').length);
  setLayerCount('loot-container-count', containerCount);
  setLayerCount('loose-loot-count', looseCount);
  setLayerCount('lab-keycard-count', labDoorEntries().length);
  const landmarkTotal = (landmarksByMap[currentMapId] || []).length + derivedLandmarks().length;
  setLayerCount('landmark-count', landmarkTotal);
  const landmarkRow = $('layer-labels').closest('label');
  $('layer-labels').disabled = landmarkTotal === 0;
  if (landmarkRow) landmarkRow.hidden = landmarkTotal === 0;
  setLayerCount('custom-count', ensureRaidData().customMarkers[currentMapId].length);
  const doorTotal = doorEntries().length;
  setLayerCount('door-count', doorTotal);
  $('layer-doors').disabled = doorTotal === 0;
  $('layer-doors-row').hidden = doorTotal === 0;
  const switchTotal = switchEntries().length;
  setLayerCount('switch-count', switchTotal);
  $('layer-switches').disabled = switchTotal === 0;
  $('layer-switches-row').hidden = switchTotal === 0;
  const bossTotal = bossZones().length;
  setLayerCount('boss-count', bossTotal);
  $('layer-bosses').disabled = bossTotal === 0;
  $('layer-bosses-row').hidden = bossTotal === 0;
  for (const [key, control, id] of containerLayers)
    setLootLayerAvailability(
      control,
      id,
      (lootData?.containers || []).filter(
        entry => lootData.containerTypes?.[entry[3]]?.category === key
      ).length
    );
  for (const [key, control, id] of looseLayers)
    setLootLayerAvailability(
      control,
      id,
      (lootData?.loose || []).filter(entry => (entry[4] || []).includes(key)).length
    );
  const available = [...containerLayers, ...looseLayers].filter(
      ([, control]) => !$(control).disabled
    ).length,
    date = lootData?.generatedAt ? new Date(lootData.generatedAt) : null;
  $('loot-source-status').textContent =
    containerCount + looseCount
      ? new Intl.NumberFormat('en-US').format(containerCount + looseCount) +
        ' source points · ' +
        available +
        ' categories' +
        (date
          ? ' · ' +
            new Intl.DateTimeFormat('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric'
            }).format(date)
          : '')
      : 'No published loot points for this map';
  $('loot-data-note').hidden = containerCount + looseCount > 0;
}

export function layerSettings() {
  const settings = {
    extracts: $('layer-extract').checked,
    pmcExtractNames: $('layer-pmc-extract-labels').checked,
    scavs: $('layer-scav').checked,
    scavExtractNames: $('layer-scav-extract-labels').checked,
    transits: $('layer-transit').checked,
    transitNames: $('layer-transit-labels').checked,
    labsKeycards: $('layer-lab-keycards').checked,
    labsKeycardNames: $('layer-lab-keycard-labels').checked,
    landmarks: $('layer-labels').checked,
    customMarkers: $('layer-custom').checked,
    lockedDoors: $('layer-doors').checked,
    switches: $('layer-switches').checked,
    bossSpawns: $('layer-bosses').checked,
    btrStops: $('layer-btr').checked,
    btrRoute: $('layer-btr-route').checked,
    ...Object.fromEntries(hazardKinds.map(kind => [kind.key, $(kind.control).checked]))
  };
  for (const [key, id] of [...containerLayers, ...looseLayers])
    settings[id.replace(/^layer-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] =
      $(id).checked;
  return settings;
}

export async function saveLayers() {
  // Every layer switch ends up here, whichever handler it came from, so this is
  // the one place that knows the map just changed shape.
  scheduleDeclutter();
  data.settings.mapLayers = layerSettings();
  try {
    await bridge.mapLayers(data.settings.mapLayers);
  } catch {
    toast('Could not save map layer preferences.', 'error');
  }
}

export function renderAllMapLayers() {
  updateLayerChildren();
  renderHazards();
  renderMarkers();
  renderExtractLabels();
  renderKeycardDoors();
  renderDoors();
  renderSwitches();
  renderBosses();
  renderLandmarks();
  renderCustomMarkers();
  renderLoot();
  scheduleDeclutter();
}

export function applyLayerPreset(name) {
  if (name === 'valuables') window.battlepassLayer?.enableAll();
  else window.battlepassLayer?.clear();
  const all = [
    'layer-extract',
    'layer-pmc-extract-labels',
    'layer-scav',
    'layer-scav-extract-labels',
    'layer-transit',
    'layer-transit-labels',
    'layer-lab-keycards',
    'layer-lab-keycard-labels',
    'layer-labels',
    'layer-custom',
    ...[...containerLayers, ...looseLayers].map(([, id]) => id)
  ];
  for (const id of all) $(id).checked = false;
  if (name === 'raid' || name === 'valuables')
    for (const id of [
      'layer-extract',
      'layer-transit',
      'layer-lab-keycards',
      'layer-labels',
      'layer-custom'
    ])
      $(id).checked = true;
  if (name === 'valuables')
    for (const id of [
      'layer-container-valuables',
      'layer-loose-valuables',
      'layer-loose-battlepass'
    ])
      $(id).checked = true;
  if (name === 'clean') for (const id of ['layer-labels', 'layer-custom']) $(id).checked = true;
  document
    .querySelectorAll('[data-layer-preset]')
    .forEach(button => button.classList.toggle('active', button.dataset.layerPreset === name));
  renderAllMapLayers();
  saveLayers();
  toast(
    name === 'raid'
      ? 'Raid view ready.'
      : name === 'valuables'
        ? 'Showing high-value loot and Battle Pass documents.'
        : 'Clean map view ready.'
  );
}
