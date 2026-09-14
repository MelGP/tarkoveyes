export const svgNS = 'http://www.w3.org/2000/svg';
import {
  H,
  W,
  allData,
  assignAllData,
  assignBossCatalog,
  assignBossSpawnRates,
  assignData,
  assignKeyCatalog,
  assignLabKeycards,
  assignMapDefinitions,
  assignMyRaidOpen,
  assignObserver,
  assignQuestImages,
  assignQuestWiki,
  assignQuests,
  assignSelected,
  assignSpecialTracks,
  assignTraderCatalog,
  assignView,
  bridge,
  currentMapId,
  data,
  floor,
  mapDefinition,
  mapDefinitions,
  markerAdding,
  myRaidOpen,
  quests,
  selected,
  specialTracks,
  view
} from './state.js';
import { containerLayers, hazardKinds } from './vocabulary.js';

import { renderLandmarks } from './landmarks.js';

import { updateQuestPathOptions } from './quest-routes.js';
import { markSelectedRow, renderList } from './quest-list.js';
import { btrStops } from './btr.js';

import { ensureRaidData, renderMyRaid } from './my-raid.js';
import { renderDetail, scheduleBriefAlign } from './quest-brief.js';
import { openMarkerEditor, renderCustomMarkers, setMarkerPlacement } from './custom-markers.js';
import { renderLogDiagnostics } from './activity.js';
import { updateItemHotkey } from './items-view.js';

import { forgetMapSvgBox, markerScale, point, projectedBounds } from './geometry.js';
import {
  indexObjectiveOwners,
  loadHideDone,
  mapName,
  objectivePoints,
  objectiveProgress,
  profile,
  source,
  status
} from './quest-state.js';
import { renderMarkers } from './markers.js';
import { renderExtractLabels, updateLayerChildren } from './map-layers.js';
import { applyFloor, baseFloor } from './floors.js';
import { panView, resetView, setDetailsCollapsed, setView, zoomView } from './view.js';
import { centerPlayer, updatePosition } from './player.js';
import { switchMap } from './map-load.js';
import { wireControls } from './wiring.js';
import { $, el, toast } from './dom.js';
import { installPreviewBridge } from './preview-bridge.js';
export const railLayout = matchMedia('(min-width: 1101px)');

export function whenBriefly(at) {
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return 'recently';
  const now = new Date();
  const sameDay =
    then.getDate() === now.getDate() &&
    then.getMonth() === now.getMonth() &&
    then.getFullYear() === now.getFullYear();
  /* 24-hour, because "08:17 AM" is three characters longer than the 244px
     rail has and the line truncated to "logs read 08:17…" - which loses the
     thing the line was added to say. */
  return sameDay
    ? then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : then.toLocaleDateString();
}
export function selectQuest(q) {
  assignMyRaidOpen(false);
  assignSelected(q);
  setDetailsCollapsed(false);
  markSelectedRow();
  renderDetail();
  renderMarkers();
  $('focus-label').textContent = q.name;
}
export async function changeProgress(change) {
  await bridge.progress({ mode: data.mode, ...change });
  if (change.type === 'quest') {
    profile().quests[change.id] = change.value;
    profile().questSources ||= {};
    if (change.value === 'untracked') delete profile().questSources[change.id];
    else profile().questSources[change.id] = 'manual';
  } else if (change.type === 'objective-counter') {
    profile().objectiveProgress ||= {};
    profile().objectiveProgress[change.id] = {
      value: change.value,
      target: change.target,
      confirmed: change.confirmed,
      source: change.source || 'manual',
      updatedAt: Date.now()
    };
    profile().objectives[change.id] = !!change.confirmed && change.value >= change.target;
  } else profile().objectives[change.id] = change.value;
}
export async function saveRaidPreferences() {
  const p = ensureRaidData(),
    payload = { mode: data.mode, map: currentMapId, hidden: p.raidHidden[currentMapId] };
  try {
    await bridge.raidPreferences(payload);
  } catch {
    toast('Could not save quest visibility.', 'error');
  }
}
export function renderBattlepass() {
  if (!mapDefinition) return;
  window.battlepassLayer?.update({
    id: currentMapId,
    width: W,
    height: H,
    floor,
    baseFloor: baseFloor(),
    floors: Array.from($('floor').options).map(o => o.value),
    scale: markerScale()
  });
}
export const looseLayers = [
  ['valuables', 'layer-loose-valuables', 'loose-valuables-count'],
  ['battlepass', 'layer-loose-battlepass', 'loose-battlepass-count'],
  ['medical', 'layer-loose-medical', 'loose-medical-count'],
  ['provisions', 'layer-loose-provisions', 'loose-provisions-count'],
  ['technical', 'layer-loose-technical', 'loose-technical-count'],
  ['keys', 'layer-loose-keys', 'loose-keys-count'],
  ['weapons', 'layer-loose-weapons', 'loose-weapons-count'],
  ['gear', 'layer-loose-gear', 'loose-gear-count'],
  ['task', 'layer-loose-task', 'loose-task-count'],
  ['other', 'layer-loose-other', 'loose-other-count']
];

export function focusRaid(list) {
  const pts = list.flatMap(q => objectivePoints(q));
  if (!pts.length) return;
  const mapped = pts.map(point),
    minX = Math.min(...mapped.map(p => p.x)),
    maxX = Math.max(...mapped.map(p => p.x)),
    minY = Math.min(...mapped.map(p => p.y)),
    maxY = Math.max(...mapped.map(p => p.y));
  const w = Math.max(260, (maxX - minX) * 1.25),
    h = Math.max(150, (maxY - minY) * 1.25);
  assignView({ x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h });
  applyFloor(baseFloor());
  setView();
}

export function price(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat('en-US').format(value) + ' ₽' : '—';
}
export function connection() {
  $('screenshots-path').value = data.settings.screenshots;
  $('logs-path').value = data.settings.logs;
  $('auto-follow').checked = data.settings.autoFollow;
  renderLogDiagnostics();
  $('connection-error').textContent = window.companion
    ? ''
    : 'Browser preview: folder monitoring is available in the Windows app.';
  $('save-connection').disabled = !window.companion;
  $('browse-screenshots').disabled = !window.companion;
  $('browse-logs').disabled = !window.companion;
  $('open-data').disabled = !window.companion;
  $('connection-dialog').showModal();
}
function initMapEvents() {
  const viewport = $('map-viewport'),
    map = $('map-svg');
  let drag = null;
  function position(e) {
    const matrix = map.getScreenCTM();
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
  }
  function worldPoint(screen) {
    const bounds = projectedBounds(),
      rotated = {
        x: bounds.minX + (screen.x / W) * (bounds.maxX - bounds.minX),
        z: bounds.maxZ - (screen.y / H) * (bounds.maxZ - bounds.minZ)
      },
      angle = (-(mapDefinition.coordinateRotation || 0) * Math.PI) / 180,
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    return { x: rotated.x * cos - rotated.z * sin, y: 0, z: rotated.x * sin + rotated.z * cos };
  }
  viewport.onpointerdown = e => {
    if (e.target.closest('.map-marker')) return;
    if (e.button !== 0) return;
    if (markerAdding) {
      e.preventDefault();
      const where = worldPoint(position(e));
      setMarkerPlacement(false);
      openMarkerEditor(where);
      return;
    }
    drag = { p: position(e), view: { ...view } };
    viewport.setPointerCapture(e.pointerId);
    $('map-popup').hidden = true;
  };
  viewport.onpointermove = e => {
    if (!drag) return;
    const p = position(e);
    view.x += drag.p.x - p.x;
    view.y += drag.p.y - p.y;
    panView();
  };
  viewport.onpointerup = () => {
    /* One full rebuild when the drag ends, so anything that culls or clusters
       settles against where the map actually is now. */
    if (drag) setView();
    drag = null;
  };
  viewport.onpointercancel = () => {
    if (drag) setView();
    drag = null;
  };
  function zoom(factor, p = { x: view.x + view.w / 2, y: view.y + view.h / 2 }) {
    const next = Math.max(60, Math.min(W * 2, view.w * factor)),
      ratio = next / view.w;
    assignView({
      x: p.x - (p.x - view.x) * ratio,
      y: p.y - (p.y - view.y) * ratio,
      w: next,
      h: view.h * ratio
    });
    zoomView();
  }
  viewport.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, position(e));
    },
    { passive: false }
  );
  $('zoom-in').onclick = () => zoom(0.75);
  $('zoom-out').onclick = () => zoom(1.33);
  $('fit-map').onclick = resetView;
  $('center-player').onclick = centerPlayer;
  $('add-marker').onclick = () => {
    setMarkerPlacement(!markerAdding);
    if (markerAdding) toast('Click anywhere on the map to place your marker.');
  };
  window.addEventListener('resize', () => {
    setView();
    scheduleBriefAlign();
  });
  /* The brief is measured to place it, and it is measured before its picture
     has loaded - the quest image is lazy, so a cached one lands before the
     measurement and an uncached one after it. When it lands late the card
     grows under a position chosen for the smaller card, and the objective
     that was supposed to sit level with the row is hundreds of pixels away.

     Watching the card's own size catches that, and every other late change:
     a font swapping in, a long objective list reflowing. There is no loop to
     worry about - alignBrief only writes `--brief-top`, which moves the card
     without resizing it. */
  if (typeof ResizeObserver === 'function') {
    const briefResize = new ResizeObserver(() => scheduleBriefAlign());
    briefResize.observe($('details'));
  }
  /* Drop the cached SVG box when the element really changes size - a window
     resize, the rail opening, the brief flying out. An observer rather than a
     list of places to remember, because a missed one would size every marker
     wrongly and nothing would report it. */
  if (typeof ResizeObserver === 'function')
    new ResizeObserver(() => forgetMapSvgBox()).observe($('map-svg'));
  railLayout.addEventListener('change', scheduleBriefAlign);
  $('quest-list').addEventListener('scroll', scheduleBriefAlign, { passive: true });
}
export async function loadMode() {
  const oldId = selected?.id;
  assignAllData(
    bridge.loadCatalog
      ? await bridge.loadCatalog(data.mode)
      : await (
          await fetch(data.mode === 'pve' ? 'data/quests-pve.json' : 'data/quests.json')
        ).json()
  );
  const extras = (specialTracks?.quests || []).filter(
    q => !q.profiles || q.profiles.includes(data.mode)
  );
  assignQuests([...allData.quests, ...extras].sort((a, b) => a.name.localeCompare(b.name)));
  indexObjectiveOwners();
  if (mapDefinition)
    $('location-sub').textContent =
      quests.filter(q => q.mapIds.includes(currentMapId)).length + ' quests on this map';
  $('trader').replaceChildren(
    new Option('All traders', ''),
    ...[...new Set(quests.map(q => q.traderName))].sort().map(t => new Option(t, t))
  );
  updateQuestPathOptions();
  assignSelected(oldId ? quests.find(q => q.id === oldId) || null : null);
  if (oldId && !selected) {
    $('details').replaceChildren(el('p', 'detail-note', 'Select a quest in this profile.'));
    $('focus-label').textContent = 'Explore ' + mapName(currentMapId);
  }
  renderList();
  if (myRaidOpen) renderMyRaid(false);
  else renderDetail();
  renderMarkers();
  renderCustomMarkers();
}
export async function start() {
  if (!bridge) installPreviewBridge();
  const boot = await bridge.bootstrap();
  assignData(boot.data);
  assignObserver(boot.observer);
  $('profile').value = data.mode;
  data.settings.itemHotkeyEnabled = data.settings.itemHotkeyEnabled !== false;
  data.settings.itemValueThreshold = Number.isFinite(data.settings.itemValueThreshold)
    ? data.settings.itemValueThreshold
    : 15000;
  updateItemHotkey(
    boot.itemHotkey || {
      enabled: data.settings.itemHotkeyEnabled,
      registered: !window.companion,
      accelerator: 'Shift+F8'
    }
  );
  data.profiles.seasonal ||= {
    quests: {},
    objectives: {},
    objectiveProgress: {},
    questSources: {},
    questSync: { seenEvents: [], lastEventAt: null, lastScanAt: null, history: [] },
    raidHidden: {},
    raidChecklist: {},
    raidPlans: {},
    raidHistory: [],
    customMarkers: {},
    questNotes: {},
    favorites: [],
    hiddenQuests: []
  };
  for (const mode of ['pvp', 'pve', 'seasonal']) {
    const p = data.profiles[mode];
    p.questSources ||= {};
    p.questSync ||= { seenEvents: [], lastEventAt: null, lastScanAt: null, history: [] };
    p.questSync.history ||= [];
    p.hiddenQuests ||= [];
    p.raidHidden ||= {};
    p.raidChecklist ||= {};
    p.raidPlans ||= {};
    p.objectiveProgress ||= {};
    p.raidHistory ||= [];
    p.customMarkers ||= {};
    p.questNotes ||= {};
    p.favorites ||= [];
  }
  const oldNames = !!data.settings.mapLayers?.extractNames;
  data.settings.mapLayers = {
    extracts: true,
    pmcExtractNames: oldNames,
    scavs: false,
    scavExtractNames: oldNames,
    transits: false,
    transitNames: false,
    containerMedical: false,
    containerRations: false,
    containerTechnical: false,
    containerWeapons: false,
    containerValuables: false,
    containerCaches: false,
    looseValuables: false,
    looseBattlepass: false,
    looseMedical: false,
    looseProvisions: false,
    looseTechnical: false,
    looseKeys: false,
    looseWeapons: false,
    looseGear: false,
    looseTask: false,
    looseOther: false,
    labsKeycards: true,
    labsKeycardNames: false,
    landmarks: true,
    customMarkers: true,
    lockedDoors: false,
    switches: false,
    bossSpawns: false,
    btrStops: false,
    btrRoute: false,
    ...Object.fromEntries(hazardKinds.map(kind => [kind.key, false])),
    ...data.settings.mapLayers
  };
  const lootControls = [...containerLayers, ...looseLayers].map(([, id]) => [
    id,
    id.replace(/^layer-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
  ]);
  for (const [id, key] of [
    ['layer-extract', 'extracts'],
    ['layer-pmc-extract-labels', 'pmcExtractNames'],
    ['layer-scav', 'scavs'],
    ['layer-scav-extract-labels', 'scavExtractNames'],
    ['layer-transit', 'transits'],
    ['layer-transit-labels', 'transitNames'],
    ...lootControls,
    ['layer-lab-keycards', 'labsKeycards'],
    ['layer-lab-keycard-labels', 'labsKeycardNames'],
    ['layer-labels', 'landmarks'],
    ['layer-custom', 'customMarkers'],
    ['layer-doors', 'lockedDoors'],
    ['layer-switches', 'switches'],
    ['layer-bosses', 'bossSpawns'],
    ['layer-btr', 'btrStops'],
    ['layer-btr-route', 'btrRoute'],
    ...hazardKinds.map(kind => [kind.control, kind.key])
  ])
    $(id).checked = !!data.settings.mapLayers[key];
  loadHideDone();
  updateLayerChildren();
  /* Was an array destructure straight into the module variables. An
     imported binding cannot be rebound, so the results land in a local
     and each one goes through its setter. */
  const loaded = await Promise.all([
    fetch('data/maps.json').then(r => r.json()),
    fetch('data/quest-images.json')
      .then(r => r.json())
      .then(doc => doc.images)
      .catch(() => ({})),
    fetch('data/boss-spawns.json')
      .then(r => r.json())
      .catch(() => null),
    fetch('data/bosses.json')
      .then(r => r.json())
      .then(doc => doc.bosses)
      .catch(() => ({})),
    fetch('data/traders.json')
      .then(r => r.json())
      .then(doc => doc.traders)
      .catch(() => ({})),
    fetch('data/keys.json')
      .then(r => r.json())
      .then(doc => doc.keys),
    fetch('data/lab-keycards.json')
      .then(r => r.json())
      .then(doc => doc.keycards),
    fetch('data/special-tracks.json').then(r => r.json()),
    fetch('data/quest-wiki.json')
      .then(r => r.json())
      .catch(() => ({}))
  ]);
  assignMapDefinitions(loaded[0]);
  assignQuestImages(loaded[1]);
  assignBossSpawnRates(loaded[2]);
  assignBossCatalog(loaded[3]);
  assignTraderCatalog(loaded[4]);
  assignKeyCatalog(loaded[5]);
  assignLabKeycards(loaded[6]);
  assignSpecialTracks(loaded[7]);
  assignQuestWiki(loaded[8]);
  const ordered = [...mapDefinitions].sort((a, b) => a.displayName.localeCompare(b.displayName));
  $('map-filter').replaceChildren(
    new Option('All maps', ''),
    ...ordered.map(map => new Option(map.displayName, map.id))
  );
  $('location').replaceChildren(...ordered.map(map => new Option(map.displayName, map.id)));
  // Only bundled, attributed artwork and POIs are loaded; no user-provided map content.
  await switchMap('customs');
  await loadMode();
  $('status-filter').value = quests.some(q => status(q) === 'active') ? 'active' : 'open';
  renderList();
  renderLandmarks();
  renderExtractLabels();
  initMapEvents();
  updatePosition();
  setDetailsCollapsed(true);
  wireControls(boot);
}
