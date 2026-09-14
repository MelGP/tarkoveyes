/*
 * The quest and item catalogues: what is bundled, what the user has imported
 * over the top, and where the prices come from.
 *
 * A custom quest catalogue is validated before it is allowed anywhere near the
 * application - every id, every objective, every coordinate - because it is
 * the one file a person can hand this program that decides what it believes.
 *
 * Prices are the only network traffic in the whole application: json.tarkov.dev
 * once about a second and a half after the window opens, and whenever Update
 * prices is pressed. The launch fetch is awaited by nothing, silent when it
 * fails, and skipped when the catalogue is under an hour old.
 *
 * It imports from main.js and main.js imports back. The cycle is safe because
 * nothing runs while the modules evaluate.
 */
/* Electron and node bindings, which the lifting tool does not carry: it only
   ever rewires local './x.js' imports, so a module it creates arrives using
   `fs` and `path` and importing neither. node --check cannot see that, and
   nor can any check that maps names to whoever exports them - these are not
   exported by anything. */
import { app } from 'electron';
import path from 'node:path';
import { assetRoot } from './paths.js';
import fs from 'node:fs';
import { store, userData, validateMode, win } from './main.js';
import { modeSlugs, normalizeItemPayload, validateItemCatalog } from '../lib/items.js';

export const pendingCatalogs = new Map();

export const questData = JSON.parse(fs.readFileSync(path.join(assetRoot, 'data/quests.json')));

export const pveData = JSON.parse(fs.readFileSync(path.join(assetRoot, 'data/quests-pve.json')));

export const seasonalData = JSON.parse(
  fs.readFileSync(path.join(assetRoot, 'data/quests-seasonal.json'))
);

export const specialData = JSON.parse(
  fs.readFileSync(path.join(assetRoot, 'data/special-tracks.json'))
);

export const mapData = JSON.parse(fs.readFileSync(path.join(assetRoot, 'data/maps.json')));

export const validMapIds = new Set(mapData.map(map => map.id));

export const ids = new Set(
  [...questData.quests, ...pveData.quests, ...seasonalData.quests, ...specialData.quests].flatMap(
    q => [q.id, ...(q.sourceQuestIds || [])]
  )
);

export const objectiveIds = new Set(
  [...questData.quests, ...pveData.quests, ...seasonalData.quests, ...specialData.quests].flatMap(
    q => q.objectives.map(o => o.id)
  )
);
app.setName('TarkovEyes');

export function catalogReport(doc) {
  const questIds = new Set(),
    objectiveIdsFound = new Set(),
    names = new Map();
  let mapPoints = 0,
    unmappedObjectives = 0,
    objectives = 0,
    sharedObjectiveIds = 0;
  if (!doc || !Array.isArray(doc.quests) || !doc.quests.length || doc.quests.length > 2000)
    throw Error('The file is not a supported quest catalog.');
  for (const quest of doc.quests) {
    if (
      typeof quest.id !== 'string' ||
      quest.id.length < 4 ||
      quest.id.length > 100 ||
      typeof quest.name !== 'string' ||
      !quest.name.trim() ||
      !Array.isArray(quest.mapIds) ||
      !Array.isArray(quest.objectives)
    )
      throw Error('The quest catalog contains an invalid quest.');
    if (questIds.has(quest.id)) throw Error('The quest catalog contains a duplicate quest ID.');
    questIds.add(quest.id);
    if (quest.mapIds.some(id => !validMapIds.has(id)))
      throw Error('The quest catalog contains an unsupported map.');
    names.set(quest.name, (names.get(quest.name) || 0) + 1);
    const questObjectiveIds = new Set();
    for (const objective of quest.objectives) {
      if (
        !objective ||
        typeof objective.id !== 'string' ||
        !objective.id ||
        typeof objective.description !== 'string'
      )
        throw Error('The quest catalog contains an invalid objective.');
      if (questObjectiveIds.has(objective.id))
        throw Error('A quest contains a duplicate objective ID.');
      questObjectiveIds.add(objective.id);
      objectives++;
      if (objectiveIdsFound.has(objective.id)) sharedObjectiveIds++;
      objectiveIdsFound.add(objective.id);
      const points = [...(objective.zones || []), ...(objective.possibleLocations || [])];
      if (!points.length) unmappedObjectives++;
      for (const zone of points) {
        if (zone.mapId && !validMapIds.has(zone.mapId))
          throw Error('A quest point uses an unsupported map.');
        const positions = zone.positions || [zone.position].filter(Boolean);
        mapPoints += positions.length;
        if (positions.some(p => ![p?.x, p?.y, p?.z].every(Number.isFinite)))
          throw Error('The quest catalog contains invalid map coordinates.');
      }
    }
  }
  return {
    quests: doc.quests.length,
    objectives,
    mapPoints,
    unmappedObjectives,
    duplicateQuestIds: 0,
    sharedObjectiveIds,
    duplicateNames: [...names.values()].filter(count => count > 1).length
  };
}

export function registerCatalog(doc) {
  for (const quest of doc.quests) {
    ids.add(quest.id);
    for (const objective of quest.objectives) objectiveIds.add(objective.id);
  }
}

export function customCatalogFile(mode) {
  return path.join(path.dirname(store.file), 'quest-catalog-' + mode + '.json');
}

export function loadCatalog(mode) {
  validateMode(mode);
  const file = customCatalogFile(mode);
  let doc = mode === 'pve' ? pveData : mode === 'seasonal' ? seasonalData : questData,
    localOverride = false;
  if (fs.existsSync(file)) {
    try {
      const custom = JSON.parse(fs.readFileSync(file, 'utf8'));
      catalogReport(custom);
      doc = custom;
      localOverride = true;
    } catch {}
  }
  const integrity = catalogReport(doc);
  registerCatalog(doc);
  return { ...doc, integrity, localOverride };
}

export function itemCatalogFile(mode) {
  return path.join(path.dirname(store.file), 'items-' + mode + '.json');
}

export function bundledItemCatalogFile(mode) {
  return path.join(assetRoot, 'data', 'items-' + mode + '.json');
}

export const itemCatalogs = new Map();

export function loadItemCatalog(mode) {
  validateMode(mode);
  for (const file of [itemCatalogFile(mode), bundledItemCatalogFile(mode)]) {
    let stamp;
    try {
      const stat = fs.statSync(file);
      stamp = file + ':' + stat.mtimeMs + ':' + stat.size;
    } catch {
      continue;
    }
    // The parsed catalog is reused until the file itself changes: the matcher
    // derives an index from it, and rebuilding that per scan is what made the
    // item hotkey feel like it had hung.
    const cached = itemCatalogs.get(mode);
    if (cached?.stamp === stamp) return cached.catalog;
    try {
      const catalog = validateItemCatalog(JSON.parse(fs.readFileSync(file, 'utf8')));
      itemCatalogs.set(mode, { stamp, catalog });
      return catalog;
    } catch {}
  }
  throw Error('The item price catalog is unavailable.');
}

export async function fetchItemJson(pathname) {
  const response = await fetch('https://json.tarkov.dev/' + pathname, {
    headers: { accept: 'application/json', 'user-agent': 'TarkovEyes item price updater' },
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw Error('tarkov.dev returned HTTP ' + response.status);
  const text = await response.text();
  if (text.length > 100 * 1024 * 1024) throw Error('The price response is too large.');
  return JSON.parse(text);
}

export async function updateItemCatalog(mode) {
  validateMode(mode);
  const slug = modeSlugs[mode],
    [items, english, traders, traderEnglish] = await Promise.all([
      fetchItemJson(slug + '/items'),
      fetchItemJson(slug + '/items_en'),
      fetchItemJson(slug + '/traders'),
      fetchItemJson(slug + '/traders_en')
    ]),
    catalog = normalizeItemPayload(items, english, traders, traderEnglish, mode),
    target = itemCatalogFile(mode),
    tmp = target + '.tmp';
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(tmp, JSON.stringify(catalog));
  await fs.promises.rename(tmp, target);
  itemCatalogs.delete(mode);
  return catalog;
}
/* Prices on launch.
 *
 * Until now this application reached the network only when a person pressed
 * Update prices, and the About panel said so in as many words. The user asked
 * for it to happen on open instead, so it does - and the About panel had to
 * be corrected in the same change, because a program that describes its own
 * network behaviour wrongly is worse than one that never described it.
 *
 * Three things keep it well-mannered:
 *
 * - **It never delays the window.** It is scheduled after the window is
 *   loading and awaited by nothing.
 * - **It is silent when it fails.** Offline is the normal case for a launch
 *   nobody asked anything of, and the bundled prices stay exactly as they
 *   were. A startup error box for something the person did not request is
 *   noise. The Items view still shows the date the prices carry, so a stale
 *   figure is never presented as fresh.
 * - **It has a floor.** tarkov.dev is a free community service and the prices
 *   move about hourly, so an hour-old catalogue is left alone. Opening the
 *   application once a session refreshes every time; opening it five times in
 *   ten minutes fetches once.
 */

/* Prices on launch.
 *
 * Until now this application reached the network only when a person pressed
 * Update prices, and the About panel said so in as many words. The user asked
 * for it to happen on open instead, so it does - and the About panel had to
 * be corrected in the same change, because a program that describes its own
 * network behaviour wrongly is worse than one that never described it.
 *
 * Three things keep it well-mannered:
 *
 * - **It never delays the window.** It is scheduled after the window is
 *   loading and awaited by nothing.
 * - **It is silent when it fails.** Offline is the normal case for a launch
 *   nobody asked anything of, and the bundled prices stay exactly as they
 *   were. A startup error box for something the person did not request is
 *   noise. The Items view still shows the date the prices carry, so a stale
 *   figure is never presented as fresh.
 * - **It has a floor.** tarkov.dev is a free community service and the prices
 *   move about hourly, so an hour-old catalogue is left alone. Opening the
 *   application once a session refreshes every time; opening it five times in
 *   ten minutes fetches once.
 */
export const priceFloorMs = 60 * 60 * 1000;

export async function refreshPricesOnLaunch() {
  const mode = store.data.mode;
  try {
    const current = loadItemCatalog(mode),
      stamp = Date.parse(current?.pricesUpdatedAt || current?.generatedAt || 0);
    if (Number.isFinite(stamp) && Date.now() - stamp < priceFloorMs) return;
    await updateItemCatalog(mode);
    // Only worth saying if the view that shows prices is already open.
    if (win && !win.isDestroyed()) win.webContents.send('prices-refreshed', mode);
  } catch {
    /* No network, or tarkov.dev is down. The bundled catalogue is still
       there and still stamped with its own date. */
  }
}
