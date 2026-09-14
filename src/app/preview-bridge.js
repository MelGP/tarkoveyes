/*
 * preview-bridge, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { $, svg, toast } from './dom.js';
import { point } from './geometry.js';
import { refreshItemPrices } from './items-view.js';
import { renderMarkers, verbGlyph } from './markers.js';
import { alignBrief } from './quest-brief.js';
import {
  activeMapQuests,
  assignIsDoneOverride,
  availableBecause,
  isDone,
  isDoneOverride,
  isDoneRecorded,
  objectivePoints,
  objectiveProgress,
  profile,
  provenLevel,
  source,
  status
} from './quest-state.js';
import {
  assignBridge,
  data,
  detailsCollapsed,
  mapFocus,
  observer,
  quests,
  selected
} from './state.js';
import { verbLabels } from './vocabulary.js';
import { connection, start } from './app.js';

/* The browser preview has no Electron bridge, so it gets a localStorage
 * stand-in and most of the renderer can be exercised at 127.0.0.1:4318
 * without the desktop app. It does not exercise IPC, folder watching,
 * desktop capture or real persistence - and it must never be reached when
 * a real bridge exists, or the saved profile would be shadowed. */
export function installPreviewBridge() {
  // Static browser preview is isolated from the desktop progress store.
  let cached;
  try {
    cached = JSON.parse(localStorage.getItem('tarkoveyes-preview'));
  } catch {}
  const freshProfile = () => ({
    quests: {},
    objectives: {},
    objectiveProgress: {},
    questSources: {},
    questSync: {
      parserVersion: 2,
      seenEvents: [],
      lastEventAt: null,
      lastScanAt: null,
      history: []
    },
    raidHidden: {},
    raidChecklist: {},
    raidPlans: {},
    raidHistory: [],
    customMarkers: {},
    questNotes: {},
    favorites: [],
    hiddenQuests: []
  });
  let d = cached || {
    version: 1,
    settings: {
      screenshots: '',
      logs: '',
      autoFollow: true,
      itemHotkeyEnabled: true,
      itemValueThreshold: 15000,
      mapLayers: {
        extracts: true,
        pmcExtractNames: false,
        scavs: false,
        scavExtractNames: false,
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
        customMarkers: true
      }
    },
    profiles: { pvp: freshProfile(), pve: freshProfile(), seasonal: freshProfile() },
    mode: 'pvp'
  };
  const save = () => localStorage.setItem('tarkoveyes-preview', JSON.stringify(d));
  assignBridge({
    bootstrap: async () => ({
      data: d,
      observer: {},
      itemHotkey: {
        enabled: d.settings.itemHotkeyEnabled !== false,
        registered: true,
        accelerator: 'Shift+F8'
      }
    }),
    progress: async c => {
      const p = d.profiles[c.mode];
      if (c.type === 'quest') p.quests[c.id] = c.value;
      else if (c.type === 'objective-counter') {
        p.objectiveProgress[c.id] = {
          value: c.value,
          target: c.target,
          confirmed: c.confirmed,
          source: c.source
        };
        p.objectives[c.id] = c.confirmed && c.value >= c.target;
      } else p.objectives[c.id] = c.value;
      save();
    },
    raidPreferences: async input => {
      d.profiles[input.mode].raidHidden[input.map] = input.hidden;
      save();
    },
    mapLayers: async layers => {
      d.settings.mapLayers = layers;
      save();
    },
    mode: async mode => {
      d.mode = mode;
      save();
    },
    loadCatalog: async mode =>
      await (
        await fetch(
          mode === 'pve'
            ? 'data/quests-pve.json'
            : mode === 'seasonal'
              ? 'data/quests-seasonal.json'
              : 'data/quests.json'
        )
      ).json(),
    loadItems: async mode => await (await fetch('data/items-' + mode + '.json')).json(),
    importCatalog: async () => null,
    inspectCatalog: async () => null,
    applyCatalog: async () => null,
    scanTasks: async () => null,
    scanItem: async () => null,
    refreshItemPrices: async () => null,
    itemHotkey: async enabled => {
      d.settings.itemHotkeyEnabled = enabled;
      save();
      return { enabled, registered: enabled, accelerator: 'Shift+F8' };
    },
    itemValueThreshold: async value => {
      d.settings.itemValueThreshold = value;
      save();
      return value;
    },
    questMeta: async input => {
      const p = d.profiles[input.mode];
      if (typeof input.note === 'string') p.questNotes[input.id] = input.note;
      if (typeof input.favorite === 'boolean') {
        const set = new Set(p.favorites);
        input.favorite ? set.add(input.id) : set.delete(input.id);
        p.favorites = [...set];
      }
      if (typeof input.hidden === 'boolean') {
        const set = new Set(p.hiddenQuests || []);
        input.hidden ? set.add(input.id) : set.delete(input.id);
        p.hiddenQuests = [...set];
      }
      save();
    },
    customMarkers: async input => {
      d.profiles[input.mode].customMarkers[input.map] = input.markers;
      save();
    },
    openWiki: async link => {
      open(link, '_blank', 'noopener');
      return true;
    },
    raidEvent: async () => null,
    exportBackup: async () => null,
    importBackup: async () => null,
    onOcrProgress: () => {},
    onObserver: () => {},
    onQuestProgress: () => {},
    onItemHotkey: () => {},
    onItemHotkeyResult: () => {}
  });
}

Object.defineProperties(window, {
  quests: { get: () => quests, configurable: true },
  selected: { get: () => selected, configurable: true },
  mapFocus: { get: () => mapFocus, configurable: true },
  detailsCollapsed: { get: () => detailsCollapsed, configurable: true },
  connection: { get: () => connection, configurable: true },
  svg: { get: () => svg, configurable: true },
  point: { get: () => point, configurable: true },
  profile: { get: () => profile, configurable: true },
  status: { get: () => status, configurable: true },
  toast: { get: () => toast, configurable: true },
  isDone: { get: () => isDone, configurable: true },
  isDoneRecorded: { get: () => isDoneRecorded, configurable: true },
  /* Settable, unlike the rest: the harness assigns a stand-in and puts
     the real one back in a finally. */
  isDoneOverride: {
    get: () => isDoneOverride,
    set: assignIsDoneOverride,
    configurable: true
  },
  renderMarkers: { get: () => renderMarkers, configurable: true },
  availableBecause: { get: () => availableBecause, configurable: true },
  start: { get: () => start, configurable: true },
  alignBrief: { get: () => alignBrief, configurable: true },
  verbGlyph: { get: () => verbGlyph, configurable: true },
  verbLabels: { get: () => verbLabels, configurable: true },
  activeMapQuests: { get: () => activeMapQuests, configurable: true },
  objectivePoints: { get: () => objectivePoints, configurable: true },
  provenLevel: { get: () => provenLevel, configurable: true }
});

start().catch(e => {
  $('map-loading').hidden = false;
  $('map-loading').textContent = 'Could not load the local map data. Restart the app.';
  console.error(e);
});
