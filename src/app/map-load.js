/*
 * map-load, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { applyFloor, baseFloor } from './floors.js';
import { renderHazards } from './hazards.js';
import { loadItemsView } from './items-view.js';
import { renderLandmarks } from './landmarks.js';
import { renderLoot } from './loot.js';
import { renderActivity } from './activity.js';
import { renderBosses } from './bosses.js';
import { setMarkerPlacement } from './custom-markers.js';
import { renderDoors, renderKeycardDoors, renderSwitches } from './doors.js';
import { $, svg, toast } from './dom.js';
import { setView, updateCompass } from './view.js';
import { modeLabel } from './vocabulary.js';
import { renderExtractLabels, updateLayerCounts, updateMapSpecificLayers } from './map-layers.js';
import { renderMarkers } from './markers.js';
import { renderMyRaid } from './my-raid.js';
import { updatePosition } from './player.js';
import { renderDetail } from './quest-brief.js';
import { renderList } from './quest-list.js';
import { mapName } from './quest-state.js';
import {
  H,
  W,
  allData,
  allPois,
  assignAllPois,
  assignConfirmedFix,
  assignCurrentMapId,
  assignFloor,
  assignH,
  assignLootData,
  assignMapDefinition,
  assignMapLoadToken,
  assignPois,
  assignView,
  assignW,
  bridge,
  currentMapId,
  data,
  floor,
  mapDefinition,
  mapDefinitions,
  mapLoadToken,
  markerAdding,
  myRaidOpen,
  quests
} from './state.js';
import { loadMode } from './app.js';

export function localAssetPath(asset) {
  return 'assets' + asset.path;
}
// Waits for the bitmap itself, not for a decoded frame. image.decode() never
// settles while the window is hidden or fully occluded, which left an
// image-based map (Icebreaker, The Labyrinth) stuck on "Loading ..." whenever
// the map changed with TarkovEyes in the background - exactly what happens when
// a raid starts while the user is in the game. onload fires either way.

// Waits for the bitmap itself, not for a decoded frame. image.decode() never
// settles while the window is hidden or fully occluded, which left an
// image-based map (Icebreaker, The Labyrinth) stuck on "Loading ..." whenever
// the map changed with TarkovEyes in the background - exactly what happens when
// a raid starts while the user is in the game. onload fires either way.
export function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(Error('Missing map artwork: ' + path));
    image.src = path;
  });
}

export async function loadMapArtwork(definition) {
  const artwork = $('artwork'),
    asset = definition.baseAsset,
    path = localAssetPath(asset);
  if (asset.type === 'svg') {
    const text = await fetch(path).then(response => {
      if (!response.ok) throw Error('Missing map artwork');
      return response.text();
    });
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml'),
      parts = (doc.documentElement.getAttribute('viewBox') || '0 0 1000 1000')
        .trim()
        .split(/\s+/)
        .map(Number);
    assignW(parts[2]);
    assignH(parts[3]);
    artwork.replaceChildren(
      ...[...doc.documentElement.childNodes].map(node => document.importNode(node, true))
    );
  } else {
    const image = await loadImage(path);
    assignW(image.naturalWidth);
    assignH(image.naturalHeight);
    artwork.replaceChildren(
      svg('image', { href: path, x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none' })
    );
  }
  $('map-svg').setAttribute('viewBox', `0 0 ${W} ${H}`);
}

export function configureFloors() {
  const control = $('floor'),
    base = { id: baseFloor(), name: mapDefinition.baseFloor?.name || 'Main' };
  const entries =
    mapDefinition.baseAsset.type === 'image' && mapDefinition.floors.some(item => item.asset)
      ? mapDefinition.floors.filter(item => item.asset)
      : [base, ...mapDefinition.floors.filter(item => item.svgLayer && item.id !== base.id)];
  control.replaceChildren(...entries.map(item => new Option(item.name, item.id)));
  control.disabled = entries.length < 2;
}

export async function switchMap(id, { filterQuests = false } = {}) {
  const definition = mapDefinitions.find(map => map.id === id);
  if (!definition) return;
  if (markerAdding) setMarkerPlacement(false);
  /* ++x on an imported binding is still a rebind. */
  assignMapLoadToken(mapLoadToken + 1);
  const token = mapLoadToken,
    currentName = definition.displayName;
  $('map-loading').hidden = false;
  $('map-loading').textContent = 'Loading ' + currentName + '…';
  const poiPromise = fetch('data/poi/' + id + '.json').then(response => {
      if (!response.ok) throw Error('Missing map POIs');
      return response.json();
    }),
    lootPromise = fetch('data/loot/' + id + '.json').then(response => {
      if (!response.ok) throw Error('Missing map loot');
      return response.json();
    });
  await loadMapArtwork(definition);
  const [poiDoc, lootDoc] = await Promise.all([poiPromise, lootPromise]);
  if (token !== mapLoadToken) return;
  assignMapDefinition(definition);
  assignCurrentMapId(id);
  assignAllPois(poiDoc.pois);
  assignPois(allPois.filter(p => p.kind === 'extract' || p.kind === 'transit'));
  assignLootData(lootDoc);
  assignConfirmedFix(null);
  updateMapSpecificLayers();
  updateCompass();
  $('location').value = id;
  $('location-sub').textContent =
    quests.filter(q => q.mapIds.includes(id)).length + ' quests on this map';
  $('map-svg').setAttribute('aria-label', currentName + ' map');
  $('map-viewport').setAttribute('aria-label', currentName + ' map: drag to pan, scroll to zoom');
  updateLayerCounts();
  $('active-map-label').textContent = 'My Raid · ' + currentName;
  if (filterQuests) $('map-filter').value = id;
  configureFloors();
  assignFloor(baseFloor());
  assignView({ x: 0, y: 0, w: W, h: H });
  applyFloor(floor);
  setView();
  $('focus-label').textContent = 'Explore ' + currentName;
  $('map-loading').hidden = true;
  if (allData) {
    renderList();
    if (myRaidOpen) renderMyRaid(false);
    else renderDetail();
  }
  renderMarkers();
  renderLoot();
  renderKeycardDoors();
  renderDoors();
  renderSwitches();
  renderBosses();
  renderLandmarks();
  renderExtractLabels();
  renderHazards();
  updatePosition();
}
/* The logs already say which mode the raid is in and which map loaded, and
 * both were only ever used to decide where to file the raid record. If the
 * game is in a Seasonal raid on Streets while the application shows PvP quests
 * for Customs, the application is describing a different game than the one on
 * the screen - and the person is in a raid, which is the worst possible moment
 * to ask them to fix it by hand.
 *
 * It follows the game rather than asking, and says so, because a profile that
 * changes itself without a word is worse than the mismatch it fixes. */

/* The logs already say which mode the raid is in and which map loaded, and
 * both were only ever used to decide where to file the raid record. If the
 * game is in a Seasonal raid on Streets while the application shows PvP quests
 * for Customs, the application is describing a different game than the one on
 * the screen - and the person is in a raid, which is the worst possible moment
 * to ask them to fix it by hand.
 *
 * It follows the game rather than asking, and says so, because a profile that
 * changes itself without a word is worse than the mismatch it fixes. */
export async function adoptObservedSession(mode, map) {
  if (mode && mode !== data.mode && ['pvp', 'pve', 'seasonal'].includes(mode)) {
    try {
      await bridge.mode(mode);
      data.mode = mode;
      $('profile').value = mode;
      await loadMode();
      if ($('activity-dialog').open) renderActivity();
      if ($('items-dialog').open) await loadItemsView();
      toast('Raid is ' + modeLabel(mode) + ' - switched your profile to match.');
    } catch {
      toast('Could not follow the raid into ' + modeLabel(mode) + '.', 'error');
    }
  }
  /* A raid start names the map before any screenshot does. Waiting for the
   * screenshot meant the map followed you into the raid only once you pressed
   * the screenshot key, which is exactly when you stop needing it to. */
  if (map && map !== currentMapId && mapDefinitions.some(definition => definition.id === map)) {
    try {
      await switchMap(map, { filterQuests: true });
      toast('Raid started on ' + mapName(map) + '.');
    } catch {
      /* the next position update tries again; nothing worth saying */
    }
  }
}
