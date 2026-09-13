const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
let W = 1062.4827,
  H = 535.17401;
let bridge = window.companion,
  data,
  observer = {},
  quests = [],
  allData,
  specialTracks = null,
  questWiki = {},
  itemCatalog = null,
  itemScanRunning = false,
  itemHotkeyState = { enabled: true, registered: false, accelerator: 'Shift+F8' },
  lastItemResults = [],
  lastItemResultsScanned = false,
  pois = [],
  allPois = [],
  lootData = null,
  lootRenderTimer = null,
  labKeycards = [],
  keyCatalog = {},
  traderCatalog = {},
  questImages = {},
  bossCatalog = {},
  bossSpawnRates = null,
  unknownQuestDetails = [],
  mapDefinition,
  mapDefinitions = [],
  currentMapId = 'customs',
  selected = null,
  mapLoadToken = 0,
  myRaidOpen = false,
  activityUnread = 0,
  ocrSelection = [],
  markerAdding = false,
  markerDraftPosition = null,
  editingMarkerId = null,
  lastRaidState = 'unknown',
  mapFocus = false,
  detailsCollapsed = true,
  commandMatches = [],
  commandIndex = 0;
let view = { x: 0, y: 0, w: W, h: H },
  floor = 'Ground_Level',
  currentFix = null,
  confirmedFix = null,
  lastFixTime = 0,
  toastTimer;
const questColors = [
  '#f4c980',
  '#83c8e8',
  '#e7a7bd',
  '#9bd4a8',
  '#c5aff0',
  '#f0a476',
  '#b6d989',
  '#8ecbc3'
];
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function svg(tag, attrs = {}) {
  const n = document.createElementNS(svgNS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}
function uiIcon(name) {
  const n = svg('svg', { class: 'icon', 'aria-hidden': 'true' });
  n.append(svg('use', { href: 'assets/icons.svg#' + name }));
  return n;
}
function rotatedPoint(p, definition = mapDefinition) {
  const radians = ((definition.coordinateRotation || 0) * Math.PI) / 180,
    cos = Math.cos(radians),
    sin = Math.sin(radians);
  return { x: p.x * cos - p.z * sin, z: p.x * sin + p.z * cos };
}
function projectedBounds(definition = mapDefinition) {
  const [[x1, z1], [x2, z2]] = definition.svgBounds || definition.bounds;
  const corners = [
    { x: x1, z: z1 },
    { x: x1, z: z2 },
    { x: x2, z: z1 },
    { x: x2, z: z2 }
  ].map(p => rotatedPoint(p, definition));
  return {
    minX: Math.min(...corners.map(p => p.x)),
    maxX: Math.max(...corners.map(p => p.x)),
    minZ: Math.min(...corners.map(p => p.z)),
    maxZ: Math.max(...corners.map(p => p.z))
  };
}
function point(p) {
  const q = rotatedPoint(p),
    b = projectedBounds();
  return {
    x: ((q.x - b.minX) / (b.maxX - b.minX)) * W,
    y: ((b.maxZ - q.z) / (b.maxZ - b.minZ)) * H
  };
}
/* A toast reports either 'done' or 'that did not work', and both wore the same
 * amber. Losing progress is the worst thing this application can report, so a
 * failure gets its own tone, interrupts rather than waits its turn, and stays
 * up long enough to read a sentence about disk space. */
function toast(message, tone) {
  const el = $('toast');
  const failed = tone === 'error';
  el.classList.toggle('toast-error', failed);
  el.setAttribute('role', failed ? 'alert' : 'status');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), failed ? 7000 : 4500);
}
function profile() {
  return data.profiles[data.mode];
}
function status(q) {
  const direct = profile().quests[q.id];
  if (direct) return direct;
  const states = (q.sourceQuestIds || []).map(id => profile().quests[id]).filter(Boolean);
  if (!states.length) return 'untracked';
  if (states.length === q.sourceQuestIds.length && states.every(value => value === 'completed'))
    return 'completed';
  if (states.includes('active') || states.includes('completed')) return 'active';
  return states.includes('failed') ? 'failed' : 'untracked';
}
/* The map only draws quests the application knows you are on, and it only
 * knows that from a log line it happened to be running for. Everything you
 * accepted before installing it, or in a session whose logs have rotated
 * away, is `untracked` - so the game says a task is 3/4 done and the map for
 * it is empty, with nothing on screen saying why. The user reported it as
 * "quests like these do not show".
 *
 * The catalogue can settle part of it without guessing. A quest records what
 * has to be true of other quests before a trader offers it, so when every one
 * of those is satisfied and the application still has no record of the quest,
 * it is one you can be offered right now and it is not being shown anywhere.
 * That is a fact about the data, not an assumption about the player - which
 * is why it is a filter and a note, and never a status the application awards
 * itself. Deciding you are on a quest you never took would be worse than the
 * silence it replaces.
 */
function requirementMet(item) {
  const dep = quests.find(q => q.id === item.taskId);
  if (!dep) return false;
  const state = status(dep);
  return (item.statuses || ['complete']).some(want =>
    want === 'complete'
      ? state === 'completed'
      : /* A quest unlocked while its predecessor was active stays unlocked
           after the predecessor is handed in, so completed satisfies active. */
        want === 'active'
        ? state === 'active' || state === 'completed'
        : state === want
  );
}
function questAvailable(q) {
  if (status(q) !== 'untracked') return false;
  const needs = q.requirements || [];
  /* A quest with no recorded prerequisite is gated on trader loyalty and
     player level, neither of which is in any file this application reads, so
     it is left out rather than claimed. */
  return needs.length > 0 && needs.every(requirementMet);
}
function unlockedByNames(q) {
  return (q.requirements || [])
    .map(item => quests.find(dep => dep.id === item.taskId)?.name)
    .filter(Boolean);
}
function source(q) {
  if (profile().questSources?.[q.id]) return profile().questSources[q.id];
  return (q.sourceQuestIds || []).some(id => profile().questSources?.[id] === 'logs')
    ? 'logs'
    : null;
}
// Objective ids are not stamped with their quest, so completing a quest left every
// one of its objectives reading as undone: a profile with 188 finished quests still
// showed "0 / 1797 objectives". This index gives isDone the missing link.
let objectiveOwner = new Map();
function indexObjectiveOwners() {
  objectiveOwner = new Map();
  for (const q of quests) for (const o of q.objectives) objectiveOwner.set(o.id, q.id);
}
function isDone(o) {
  if (profile().objectives[o.id]) return true;
  if (o.sourceQuestId && profile().quests[o.sourceQuestId] === 'completed') return true;
  const questId = objectiveOwner.get(o.id);
  return !!questId && profile().quests[questId] === 'completed';
}
function objectiveTarget(o) {
  for (const detail of o.details || []) {
    const match = String(detail).match(/(?:required\s+count|count|required)\s*:?\s*(\d+)/i);
    if (match) return Math.max(1, Number(match[1]));
  }
  const match = String(o.description || '').match(
    /\b(?:kill|eliminate|find|obtain|hand over|place|plant|mark|stash|locate)\D{0,35}(\d+)\b/i
  );
  return match ? Math.max(1, Number(match[1])) : 1;
}
function objectiveProgress(o) {
  const saved = profile().objectiveProgress?.[o.id],
    target = saved?.target || objectiveTarget(o);
  return {
    value: Math.min(saved?.value ?? (isDone(o) ? target : 0), target),
    target,
    confirmed: saved?.confirmed ?? isDone(o),
    source: saved?.source || 'manual'
  };
}
function requirementId(req) {
  return typeof req === 'string' ? null : req?.questId || req?.taskId || req?.id || null;
}
function pathToSeeds(seedIds) {
  const result = new Set(),
    visit = id => {
      if (!id || result.has(id)) return;
      result.add(id);
      const q = quests.find(item => item.id === id);
      for (const req of q?.requirements || []) visit(requirementId(req));
    };
  seedIds.forEach(visit);
  return result;
}
function collectorPath() {
  const tagged = quests.filter(q => q.kappaRequired);
  return tagged.length
    ? new Set(tagged.map(q => q.id))
    : pathToSeeds(quests.filter(q => q.name === 'Collector').map(q => q.id));
}
function lightkeeperPath() {
  return pathToSeeds(
    quests
      .filter(
        q => q.lightkeeperRequired || q.traderName === 'Lightkeeper' || /lightkeeper/i.test(q.name)
      )
      .map(q => q.id)
  );
}
function questPathSet(value) {
  if (value === 'collector') return collectorPath();
  if (value === 'lightkeeper') return lightkeeperPath();
  if (value === 'story') return new Set(quests.filter(q => q.category === 'story').map(q => q.id));
  if (value === 'favorites') return new Set(profile().favorites || []);
  return new Set(quests.map(q => q.id));
}
function updateQuestPathOptions() {
  const labels = {
    all: 'All routes',
    favorites: 'Favorites',
    collector: 'Kappa required',
    lightkeeper: 'Lightkeeper route',
    story: 'Story chapters'
  };
  for (const option of $('path-filter').options) {
    const count = option.value === 'all' ? quests.length : questPathSet(option.value).size;
    option.textContent = labels[option.value] + ' · ' + count;
  }
}
function applyQuestPathFilter() {
  const value = $('path-filter').value;
  if (value !== 'all') {
    $('quest-search').value = '';
    $('map-filter').value = '';
    $('trader').value = '';
    $('status-filter').value = 'all';
  }
  renderList();
  if (value !== 'all') toast($('path-filter').selectedOptions[0].textContent + ' quests shown.');
}
function unlockedBy(id) {
  return quests.filter(q => (q.requirements || []).some(req => requirementId(req) === id));
}
/* The same ternary was written out in three places and is about to be needed
 * in two more. */
function modeLabel(mode) {
  return mode === 'seasonal' ? 'Seasonal/Kord Breach' : String(mode).toUpperCase();
}
function mapName(id) {
  const known = mapDefinitions.find(map => map.id === id)?.displayName;
  return (
    known ||
    id
      .split('-')
      .map(word => word[0]?.toUpperCase() + word.slice(1))
      .join(' ')
  );
}
function questMaps(q) {
  return q.mapIds?.length ? q.mapIds.map(mapName).join(', ') : 'Any location';
}
function activeMapQuests() {
  /* A quest you have hidden should not be on the map either - hiding it in the
     list and leaving its markers on the artwork would be the worst of both. */
  const hiddenQuests = new Set(profile().hiddenQuests || []);
  return quests.filter(
    q => status(q) === 'active' && q.mapIds.includes(currentMapId) && !hiddenQuests.has(q.id)
  );
}
function ensureRaidData() {
  const p = profile();
  p.raidHidden ||= {};
  p.customMarkers ||= {};
  p.raidHidden[currentMapId] ||= [];
  p.customMarkers[currentMapId] ||= [];
  return p;
}
function hiddenOnCurrentMap() {
  return new Set(ensureRaidData().raidHidden[currentMapId]);
}
function visibleRaidQuests() {
  const hidden = hiddenOnCurrentMap();
  return activeMapQuests().filter(q => !hidden.has(q.id));
}
/* Renderer-only, the way Battle Pass category visibility is: it decides what
   is drawn and nothing else, so putting it in progress.json would mean a new
   key in the map-layers validator, a default in the profile shape and a
   migration for everyone who already has a saved file - three places to get
   wrong for a checkbox about drawing. */
const hideDoneKey = 'tarkoveyes-hide-done-objectives-v1';
let hideDoneObjectives = false;
function loadHideDone() {
  try {
    hideDoneObjectives = localStorage.getItem(hideDoneKey) === '1';
  } catch {
    hideDoneObjectives = false;
  }
  const box = $('layer-hide-done');
  if (box) box.checked = hideDoneObjectives;
}
function setHideDone(value) {
  hideDoneObjectives = value;
  try {
    localStorage.setItem(hideDoneKey, value ? '1' : '0');
  } catch {
    /* a private window or blocked site data; the choice still holds for
       this session, which is the part that matters on screen */
  }
  renderMarkers();
  /* Every layer switch goes through saveLayers() so that the decluttering
     runs after the map changes shape. This one does not touch the saved
     layer settings, so it has to do that half itself. */
  scheduleDeclutter();
}
function doneObjectivesOnMap() {
  let total = 0;
  for (const q of activeMapQuests())
    for (const p of objectivePoints(q)) if (isDone(p.objective)) total++;
  return total;
}
function questMarkerMeta(q) {
  const index = activeMapQuests().findIndex(item => item.id === q.id);
  return {
    number: index < 0 ? null : index + 1,
    color: questColors[Math.max(0, index) % questColors.length]
  };
}
function floorName(id) {
  return (
    mapDefinition.floors.find(item => item.id === id)?.name ||
    (mapDefinition.baseFloor?.id === id ? mapDefinition.baseFloor.name : id.replaceAll('_', ' '))
  );
}
function objectivePoints(q, onlyId = null) {
  const result = [],
    seen = new Set();
  for (const o of q.objectives) {
    if (onlyId && o.id !== onlyId) continue;
    const zones = (o.zones || [])
      .filter(z => z.mapId === currentMapId)
      .map(z => ({ ...z.position, candidate: false }));
    const possible = (o.possibleLocations || [])
      .filter(z => z.mapId === currentMapId)
      .flatMap(z => z.positions.map(p => ({ ...p, candidate: true })));
    for (const p of [...zones, ...possible]) {
      const key = [o.id, p.x.toFixed(2), p.z.toFixed(2)].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ ...p, objective: o, candidate: p.candidate });
    }
  }
  return result;
}
function objectiveMapCounts(objectives) {
  const counts = new Map();
  for (const o of objectives || []) {
    for (const z of o.zones || []) if (z.mapId) counts.set(z.mapId, (counts.get(z.mapId) || 0) + 1);
    for (const z of o.possibleLocations || [])
      if (z.mapId)
        counts.set(z.mapId, (counts.get(z.mapId) || 0) + Math.max(1, (z.positions || []).length));
  }
  return counts;
}
function mappedElsewhere(objectives) {
  const counts = objectiveMapCounts(objectives);
  counts.delete(currentMapId);
  let best = null;
  for (const [id, count] of counts) {
    if (!mapDefinitions.some(map => map.id === id)) continue;
    if (!best || count > best.count) best = { id, count };
  }
  return best;
}
async function openQuestOnMap(q, mapId, onlyId) {
  await switchMap(mapId);
  if (currentMapId !== mapId) return;
  focusQuest(q, onlyId);
}
const carryActions = {
  plantItem: 'Plant',
  plantQuestItem: 'Plant',
  giveItem: 'Hand in',
  giveQuestItem: 'Hand in',
  useItem: 'Use'
};
function objectiveOnCurrentMap(o) {
  return !o.mapIds?.length || o.mapIds.includes(currentMapId);
}
function collectRequirement(store, label, quest, objective, extra) {
  const entry = store.get(label) || { label, quests: new Set(), optional: true, ...extra };
  entry.quests.add(quest.name);
  if (!objective.optional) entry.optional = false;
  store.set(label, entry);
}
function raidKit(questList) {
  const keys = new Map(),
    carry = new Map();
  for (const q of questList) {
    for (const o of q.objectives) {
      if (isDone(o) || !objectiveOnCurrentMap(o)) continue;
      for (const group of o.requiredKeys || [])
        if (group.length) collectRequirement(keys, group.join(' or '), q, o);
      const action = carryActions[o.type];
      if (action)
        for (const name of o.itemNames || []) collectRequirement(carry, name, q, o, { action });
    }
  }
  const order = (a, b) =>
    a.optional === b.optional ? a.label.localeCompare(b.label) : a.optional ? 1 : -1;
  return { keys: [...keys.values()].sort(order), carry: [...carry.values()].sort(order) };
}
function questKeyList(q) {
  const keys = new Map();
  for (const o of q.objectives) {
    if (isDone(o)) continue;
    for (const group of o.requiredKeys || [])
      if (group.length) collectRequirement(keys, group.join(' or '), q, o);
  }
  for (const k of q.neededKeys || [])
    if (![...keys.keys()].some(label => label.includes(k.name)))
      keys.set(k.name, { label: k.name, optional: false, quests: new Set() });
  const mapsByName = new Map((q.neededKeys || []).map(k => [k.name, k.mapIds || []]));
  for (const entry of keys.values())
    entry.maps = [
      ...new Set(entry.label.split(' or ').flatMap(name => mapsByName.get(name) || []))
    ];
  return [...keys.values()].sort((a, b) =>
    a.optional === b.optional ? a.label.localeCompare(b.label) : a.optional ? 1 : -1
  );
}
function baseFloor() {
  if (mapDefinition.baseAsset.type === 'image') {
    const first = mapDefinition.floors.find(item => item.asset);
    if (first) return first.id;
  }
  return mapDefinition.baseFloor?.id || mapDefinition.baseAsset.baseLayer || 'base';
}
function floorFor(p) {
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
function applyFloor(value) {
  floor = value;
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
  renderBosses();
  renderLoot();
  renderBattlepass();
  renderHazards();
}
// Quest rows used to show initials. The portraits are bundled from tarkov.dev,
// but Story and Battle Pass tracks have no trader, and a file can go missing,
// so the initials stay as the fallback rather than leaving an empty square.
function traderInitials(name) {
  return name
    .split(/s+/)
    .map(word => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
function traderBadge(quest) {
  const portrait = traderCatalog[quest.traderId];
  if (!portrait) {
    const badge = el('span', 'trader-badge', traderInitials(quest.traderName));
    badge.dataset.trader = quest.traderName;
    badge.setAttribute('aria-hidden', 'true');
    return badge;
  }
  const image = el('img', 'trader-badge trader-portrait');
  image.src = portrait.image;
  image.alt = '';
  image.loading = 'lazy';
  image.title = quest.traderName;
  image.dataset.trader = quest.traderName;
  image.setAttribute('aria-hidden', 'true');
  image.onerror = () => {
    const badge = el('span', 'trader-badge', traderInitials(quest.traderName));
    badge.dataset.trader = quest.traderName;
    badge.setAttribute('aria-hidden', 'true');
    image.replaceWith(badge);
  };
  return image;
}
function renderList() {
  const search = $('quest-search').value.trim().toLowerCase(),
    map = $('map-filter').value,
    trader = $('trader').value,
    filter = $('status-filter').value,
    pathFilter = $('path-filter')?.value || 'all',
    favorites = new Set(profile().favorites || []),
    hiddenQuests = new Set(profile().hiddenQuests || []),
    collector = pathFilter === 'collector' ? collectorPath() : null,
    lightkeeper = pathFilter === 'lightkeeper' ? lightkeeperPath() : null;
  const matching = quests.filter(
    q =>
      /* Hidden quests leave every list and the map. The Hidden filter is how
         they come back - without it they would be unreachable, which is a
         trap rather than a feature. */
      (filter === 'hidden' ? hiddenQuests.has(q.id) : !hiddenQuests.has(q.id)) &&
      (!map || q.mapIds.includes(map)) &&
      (!trader || q.traderName === trader) &&
      (filter === 'all' ||
        (filter === 'open' && status(q) !== 'completed') ||
        (filter === 'available' && questAvailable(q)) ||
        /* the inverse of Untracked: anything you have started, finished or
           failed, which is what the Tracked quests bar counts */
        (filter === 'tracked' && status(q) !== 'untracked') ||
        filter === 'hidden' ||
        status(q) === filter) &&
      (pathFilter !== 'favorites' || favorites.has(q.id)) &&
      (!collector || collector.has(q.id)) &&
      (!lightkeeper || lightkeeper.has(q.id)) &&
      (pathFilter !== 'story' || q.category === 'story') &&
      (!search ||
        [
          q.name,
          q.summary,
          q.traderName,
          ...q.mapIds.map(mapName),
          ...q.objectives.map(o => o.description)
        ]
          .join(' ')
          .toLowerCase()
          .includes(search))
  );
  $('quest-list').replaceChildren();
  if (!matching.length)
    $('quest-list').append(
      el('p', 'no-results', 'No quests match these filters. Try another name, trader or status.')
    );
  matching.forEach((q, i) => {
    const row = el('button', 'quest-row' + (q.id === selected?.id ? ' selected' : ''));
    row.dataset.questId = q.id;
    row.setAttribute('aria-label', q.name);
    row.setAttribute('aria-pressed', String(q.id === selected?.id));
    const body = el('div', 'quest-copy');
    /* A wider rail fits nine names in ten; the tenth is still an ellipsis, so
       the row carries the full name for a hover and for a screen reader. */
    const nameEl = el('strong', '', q.name);
    nameEl.title = q.name;
    body.append(nameEl);
    const markerCount = objectivePoints(q).length;
    body.append(
      el(
        'small',
        'quest-where',
        q.traderName +
          ' · ' +
          questMaps(q) +
          (markerCount
            ? ' · ' +
              markerCount +
              ' ' +
              mapName(currentMapId) +
              ' point' +
              (markerCount === 1 ? '' : 's')
            : '')
      )
    );
    body.append(el('small', 'quest-trader', q.traderName));
    if (source(q) === 'logs') body.append(el('small', 'log-source', 'Updated from logs'));
    const points = el('span', 'quest-points', markerCount ? String(markerCount) : '');
    points.title = markerCount
      ? markerCount + ' point' + (markerCount === 1 ? '' : 's') + ' on ' + mapName(currentMapId)
      : 'No point on this map';
    points.setAttribute('aria-hidden', 'true');
    const badge = traderBadge(q);
    const statusDot = el('span', 'quest-status ' + status(q));
    statusDot.title = status(q);
    statusDot.setAttribute('aria-hidden', 'true');
    const arrow = uiIcon('chevron');
    arrow.classList.add('quest-arrow');
    row.title = q.name + ' — ' + q.traderName + ' · ' + questMaps(q) + ' · ' + status(q);
    row.append(badge, body, points, statusDot, arrow);
    row.onclick = () => selectQuest(q);
    $('quest-list').append(row);
  });
  $('quest-count').textContent = matching.length;
  scheduleBriefAlign();
  const filterSummary = $('filter-summary');
  if (filterSummary) {
    const parts = [];
    /* The search narrows the list as much as any of the selects do, and
       leaving it out made the summary read "All quests" over eleven rows of
       five hundred - which looks like the list is broken rather than
       searched. */
    if (search) parts.push('"' + $('quest-search').value.trim() + '"');
    if (map) parts.push(mapName(map));
    if (trader) parts.push(trader);
    parts.push($('status-filter').selectedOptions[0].textContent);
    if (pathFilter !== 'all')
      parts.push($('path-filter').selectedOptions[0].textContent.replace(/ · .*$/, ''));
    filterSummary.textContent = parts.join(' · ');
  }
  const done = quests.filter(q => status(q) === 'completed').length;
  $('active-count').textContent = quests.filter(
    q => status(q) === 'active' && q.mapIds.includes(currentMapId)
  ).length;
  $('progress-label').textContent = done + ' / ' + quests.length + ' completed';
  $('progress-bar').style.width = (done / quests.length) * 100 + '%';
  const sync = profile().questSync || {};
  $('quest-sync').textContent = sync.lastScanAt
    ? 'Logs checked: ' + new Date(sync.lastScanAt).toLocaleString()
    : sync.lastEventAt
      ? 'Last quest event: ' + new Date(sync.lastEventAt).toLocaleString()
      : 'Progress is saved on this PC.';
}
/* On a wide window the quest brief is a card beside the rail rather than a
 * column across the map, so something has to tell it where to sit: level with
 * the row you clicked. That is the whole point of the layout - the objectives
 * land under your eyes instead of on the far side of the window.
 *
 * Everything here is a no-op below 1101px, where the brief is still a panel
 * and the stylesheet says so. The media query is the single source of truth
 * for which layout is in play; do not add a second one.
 */
const railLayout = matchMedia('(min-width: 1101px)');
let briefAlignFrame = 0;

function alignBrief() {
  briefAlignFrame = 0;
  const main = document.querySelector('main');
  const brief = $('details');
  if (!main || !brief) return;
  const off = !railLayout.matches || detailsCollapsed || mapFocus;
  if (off) {
    main.style.removeProperty('--brief-top');
    main.style.removeProperty('--notch-y');
    main.classList.remove('brief-tied');
    return;
  }
  const stage = main.getBoundingClientRect();
  const inset = 12;
  const height = brief.offsetHeight;
  const lowest = Math.max(inset, stage.height - inset - height);
  const row =
    $('quest-list').querySelector('.quest-row.selected') || (myRaidOpen ? $('show-active') : null);
  let top = inset;
  let tied = false;
  if (row) {
    const box = row.getBoundingClientRect();
    /* A row scrolled out of the list has no position worth pointing at, so the
       card stays where it is and the notch goes away rather than aiming at
       something off screen. */
    if (box.bottom > stage.top + 4 && box.top < stage.bottom - 4) {
      /* What should land level with the row is the first objective, not the
         top of the card. Above it sit the picture, the trader, the title, the
         map chips and BRING TO RAID - around 540px on a typical quest - and
         aligning the card's top instead leaves the objectives most of a
         screen below the row you clicked, which is the whole thing this
         layout exists to fix. */
      /* A quest brief leads with its objectives, so that is what should land
         level with the row. My Raid has none - it leads with its summary, at
         the very top of the card - and reaching for the first `.detail-section`
         instead aimed at BRING TO RAID, several hundred pixels down, which
         clamped the card to the top of the window and left the notch pointing
         a long way back up at the button. No objectives means no lead. */
      const target = brief.querySelector('.objective');
      const lead = target
        ? target.getBoundingClientRect().top - brief.getBoundingClientRect().top + brief.scrollTop
        : 0;
      top = Math.min(Math.max(box.top - stage.top - lead, inset), lowest);
      tied = true;
      const notch = Math.round(box.top - stage.top + box.height / 2 - top);
      main.style.setProperty('--notch-y', Math.min(Math.max(notch, 12), height - 12) + 'px');
      if (notch < 8 || notch > height - 8) tied = false;
    }
  }
  main.style.setProperty('--brief-top', Math.round(top) + 'px');
  main.classList.toggle('brief-tied', tied);
}

/* The brief is a floating card now, so it needs to introduce itself: a
 * landmark with a name, rather than an unlabelled aside that a screen reader
 * announces as nothing in particular. Set from whatever the card is currently
 * showing - a quest, or My Raid. */
function describeBrief(label) {
  const brief = $('details');
  if (!brief) return;
  brief.setAttribute('role', 'region');
  brief.setAttribute('aria-label', label);
}
function scheduleBriefAlign() {
  if (briefAlignFrame) return;
  briefAlignFrame = requestAnimationFrame(alignBrief);
}

/* "logs synced" says the connection works; it does not say whether it has
 * looked recently, which is the thing you want to know after a raid. The
 * footer line that carried the timestamp is hidden in the rail - showing it
 * costs a quest row - so the freshness goes where you already look for the
 * connection, at no extra height. A time alone would be a lie a day later,
 * so anything older than today says the date instead. */
function whenBriefly(at) {
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
function setDetailsCollapsed(collapsed) {
  detailsCollapsed = !!collapsed;
  const main = document.querySelector('main');
  main.classList.toggle('details-collapsed', detailsCollapsed);
  $('toggle-details').classList.toggle('active', !detailsCollapsed);
  $('toggle-details').setAttribute('aria-expanded', String(!detailsCollapsed));
  $('toggle-details').title = detailsCollapsed ? 'Show quest details' : 'Hide quest details';
  scheduleBriefAlign();
  requestAnimationFrame(() => setView());
}
function setMapFocus(active) {
  mapFocus = !!active;
  document.querySelector('main').classList.toggle('map-focus', mapFocus);
  scheduleBriefAlign();
  $('focus-map').classList.toggle('active', mapFocus);
  $('focus-map').setAttribute('aria-pressed', String(mapFocus));
  $('focus-map').querySelector('span').textContent = mapFocus ? 'Exit' : 'Focus';
  $('focus-map').title = mapFocus ? 'Exit focus map (F or Esc)' : 'Focus map (F)';
  requestAnimationFrame(() => setView());
}
function focusMapPosition(position, label) {
  const projected = point(position),
    width = Math.max(220, Math.min(view.w, W * 0.42));
  view = centeredView(projected, width, (width * H) / W);
  applyFloor(floorFor(position));
  setView();
  $('focus-label').textContent = label;
  toast('Showing ' + label + '.');
}
/* Choosing a quest moves a class between two rows. It used to rebuild the whole
 * list to do it, which is fine for the eleven rows an average map filter shows
 * and is not fine at all for the 503 rows "All quests" shows - 16.8ms, on every
 * arrow key. Nothing renderList() reads changes when the selection does:
 * the search text, the map, the trader, the status and the path filter are all
 * exactly as they were.
 */
let listRenderTimer = 0;
function scheduleListRender() {
  clearTimeout(listRenderTimer);
  listRenderTimer = setTimeout(renderList, 110);
}
function markSelectedRow() {
  for (const row of $('quest-list').querySelectorAll('.quest-row')) {
    const chosen = row.dataset.questId === selected?.id;
    row.classList.toggle('selected', chosen);
    row.setAttribute('aria-pressed', String(chosen));
  }
  scheduleBriefAlign();
}
function selectQuest(q) {
  myRaidOpen = false;
  selected = q;
  setDetailsCollapsed(false);
  markSelectedRow();
  renderDetail();
  renderMarkers();
  $('focus-label').textContent = q.name;
}
async function changeProgress(change) {
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
async function saveRaidPreferences() {
  const p = ensureRaidData(),
    payload = { mode: data.mode, map: currentMapId, hidden: p.raidHidden[currentMapId] };
  try {
    await bridge.raidPreferences(payload);
  } catch {
    toast('Could not save quest visibility.', 'error');
  }
}
function renderDetail() {
  if (!selected) return;
  const q = selected,
    panel = $('details');
  panel.replaceChildren();
  const head = el('div', 'detail-head'),
    titleRow = el('div', 'detail-title-row');
  titleRow.append(el('h2', '', q.name));
  const favorite = el(
    'button',
    'favorite-button',
    (profile().favorites || []).includes(q.id) ? '★' : '☆'
  );
  favorite.title = 'Favorite quest';
  favorite.setAttribute('aria-label', 'Favorite ' + q.name);
  favorite.onclick = async () => {
    const favorites = new Set(profile().favorites || []);
    favorites.has(q.id) ? favorites.delete(q.id) : favorites.add(q.id);
    profile().favorites = [...favorites];
    await bridge.questMeta({ mode: data.mode, id: q.id, favorite: favorites.has(q.id) });
    renderDetail();
    renderList();
  };
  titleRow.append(favorite);
  /* Five hundred quests and you will never do all of them. Hiding one takes it
     out of every list and off the map; the Hidden status filter is how it comes
     back, so nothing is ever lost behind this button. */
  const isHidden = (profile().hiddenQuests || []).includes(q.id);
  const hideButton = el('button', 'favorite-button hide-button', isHidden ? '◉' : '◌');
  hideButton.title = isHidden ? 'Show this quest again' : 'Hide this quest from lists and the map';
  hideButton.setAttribute('aria-label', (isHidden ? 'Show ' : 'Hide ') + q.name);
  hideButton.setAttribute('aria-pressed', String(isHidden));
  hideButton.onclick = async () => {
    const hiddenQuests = new Set(profile().hiddenQuests || []);
    isHidden ? hiddenQuests.delete(q.id) : hiddenQuests.add(q.id);
    profile().hiddenQuests = [...hiddenQuests];
    try {
      await bridge.questMeta({ mode: data.mode, id: q.id, hidden: !isHidden });
    } catch {
      toast('Could not save that.', 'error');
    }
    renderDetail();
    renderList();
    renderMarkers();
    toast(
      isHidden
        ? q.name + ' is back in your lists.'
        : q.name + ' hidden. Find it again with the Hidden filter.'
    );
  };
  titleRow.append(hideButton);
  const questPicture = questImages[q.id];
  if (questPicture) {
    const hero = el('img', 'brief-hero');
    hero.src = questPicture;
    hero.alt = '';
    hero.loading = 'lazy';
    hero.onerror = () => hero.remove();
    head.append(hero);
  }
  const briefTrader = el('div', 'brief-trader');
  const briefPortrait = traderCatalog[q.traderId];
  if (briefPortrait) {
    const image = el('img', 'brief-trader-portrait');
    image.src = briefPortrait.image;
    image.alt = '';
    image.onerror = () => image.remove();
    briefTrader.append(image);
  }
  briefTrader.append(el('span', 'eyebrow', q.traderName.toUpperCase() + ' / QUEST BRIEF'));
  head.append(briefTrader, titleRow);
  const meta = el('div', 'detail-meta');
  meta.append(el('span', 'pill', questMaps(q)), el('span', 'pill', data.mode.toUpperCase()));
  if (q.minPlayerLevel > 0) meta.append(el('span', 'pill', 'Level ' + q.minPlayerLevel));
  if (source(q) === 'logs') meta.append(el('span', 'pill log-source', 'Updated from logs'));
  /* The renderer cannot follow a link - navigation is denied and the CSP is
     default-src 'self' - so the page opens in the real browser through a
     handler that accepts nothing but a fandom wiki path. 523 of the 541
     bundled quests have a page; the event quests Ref hands out do not, and
     those get no button rather than a guessed URL that lands on a 404. */
  const wikiPage = questWiki[q.id];
  if (wikiPage) {
    const wiki = el('button', 'pill wiki-link', 'Wiki ↗');
    wiki.title = 'Open the wiki page for ' + q.name + ' in your browser';
    wiki.onclick = () =>
      Promise.resolve(bridge.openWiki(wikiPage)).catch(() =>
        toast('Could not open the wiki page.', 'error')
      );
    meta.append(wiki);
  }
  head.append(meta);
  const mapPoints = objectivePoints(q),
    currentName = mapName(currentMapId),
    elsewhere = mapPoints.length ? null : mappedElsewhere(q.objectives);
  const focus = el(
    'button',
    'primary',
    mapPoints.length
      ? 'Show objectives on ' + currentName + ' ↗'
      : elsewhere
        ? 'Open on ' + mapName(elsewhere.id) + ' ↗'
        : 'No fixed map point'
  );
  focus.disabled = !mapPoints.length && !elsewhere;
  if (elsewhere)
    focus.title = 'Switch the tactical map to ' + mapName(elsewhere.id) + ' and show this quest';
  focus.onclick = elsewhere ? () => openQuestOnMap(q, elsewhere.id) : () => focusQuest(q);
  head.append(focus);
  const stateRow = el('div', 'progress-control');
  stateRow.append(el('span', '', 'My progress'));
  const select = el('select');
  select.id = 'quest-state';
  select.setAttribute('aria-label', 'Quest status');
  for (const [value, label] of [
    ['untracked', 'Untracked'],
    ['active', 'Active'],
    ['failed', 'Failed'],
    ['completed', 'Completed']
  ]) {
    const o = el('option', '', label);
    o.value = value;
    select.append(o);
  }
  select.value = status(q);
  select.onchange = async () => {
    try {
      await changeProgress({ type: 'quest', id: q.id, value: select.value });
      renderList();
      renderMarkers();
      toast('Quest progress saved locally.');
    } catch {
      select.value = status(q);
      toast('Could not save progress. Check available disk space.', 'error');
    }
  };
  stateRow.append(select);
  head.append(stateRow);
  /* An untracked quest draws nothing on the map, and until now nothing said
     so - the map was simply empty and the select read "Untracked", which is a
     true word that explains nothing. Say what is missing and what fixes it,
     here, where the fix is. */
  if (status(q) === 'untracked') {
    const unlocks = questAvailable(q) ? unlockedByNames(q) : [];
    const points = objectivePoints(q).length;
    head.append(
      el(
        'small',
        'progress-hint',
        (unlocks.length ? 'Unlocked by ' + unlocks.join(' and ') + '. ' : '') +
          'This app has no record that you have taken it on, so it is left off the map' +
          (points
            ? ' - set it Active to put its ' +
              points +
              ' point' +
              (points === 1 ? '' : 's') +
              ' on ' +
              mapName(currentMapId) +
              '.'
            : '.')
      )
    );
  }
  panel.append(head);
  const questKeys = questKeyList(q);
  if (questKeys.length) {
    const gear = el('div', 'detail-section detail-kit');
    gear.append(el('div', 'section-title', 'KEYS TO BRING'));
    questKeys.forEach(k => {
      const row = el('p', 'requirement' + (k.optional ? ' optional-requirement' : ''));
      row.append(keyIconFor(k.label), el('span', '', k.label));
      const meta = [
        ...(q.mapIds?.length > 1 ? k.maps.map(mapName) : []),
        ...(k.optional ? ['optional objective'] : [])
      ];
      if (meta.length) row.append(el('small', '', meta.join(' · ')));
      gear.append(row);
    });
    gear.append(el('small', '', 'Keys for objectives you already confirmed are not listed.'));
    panel.append(gear);
  }
  const section = el('div', 'detail-section detail-objectives'),
    title = el('div', 'section-title');
  title.append(
    el('span', 'eyebrow', 'OBJECTIVES'),
    el('span', 'count', q.objectives.filter(isDone).length + ' / ' + q.objectives.length)
  );
  section.append(title);
  const objectiveMeter = el('progress', 'objective-meter');
  objectiveMeter.max = Math.max(1, q.objectives.length);
  objectiveMeter.value = q.objectives.filter(isDone).length;
  objectiveMeter.setAttribute('aria-label', 'Completed objectives');
  section.append(objectiveMeter);
  q.objectives.forEach((o, i) => {
    const progress = objectiveProgress(o),
      row = el(
        'div',
        'objective' +
          (isDone(o) ? ' done' : '') +
          (progress.source === 'ocr' && !progress.confirmed ? ' pending' : '')
      );
    const check = el('input');
    check.type = 'checkbox';
    check.checked = isDone(o);
    check.setAttribute('aria-label', 'Confirm objective ' + (i + 1));
    if (status(q) === 'completed') {
      // The quest is done, so every objective under it is too. Leaving the box
      // clickable would just snap back on the next render.
      check.disabled = true;
      check.title = 'This quest is marked completed.';
    }
    check.onchange = async () => {
      try {
        await changeProgress({
          type: 'objective-counter',
          id: o.id,
          value: check.checked ? progress.target : progress.target > 1 ? progress.value : 0,
          target: progress.target,
          confirmed: check.checked,
          source: 'manual'
        });
        renderDetail();
        renderMarkers();
      } catch {
        check.checked = isDone(o);
        toast('Could not save the objective.', 'error');
      }
    };
    /* The same five glyphs the map draws, beside the sentence they stand for.
       That is the legend: nobody has to be taught a magnifier once they have
       seen it next to "Find and obtain", and the two views stop being two
       separate vocabularies for one quest. */
    const verb = objectiveVerb(o);
    const mark = svg('svg', {
      class: 'objective-verb',
      viewBox: '-8 -8 16 16',
      'aria-hidden': 'true'
    });
    for (const shape of verbGlyph(verb, 'currentColor')) mark.append(shape);
    mark.appendChild(svg('title')).textContent = verbLabels[verb] || 'Objective';
    const body = el('div');
    body.append(el('p', '', o.description));
    if (o.optional) body.append(el('small', '', 'Optional objective'));
    (o.details || [])
      .filter(d => d !== 'Optional objective')
      .forEach(d => body.append(el('small', '', d)));
    if (o.itemNames?.length) body.append(el('small', '', 'Items: ' + o.itemNames.join(' · ')));
    if (o.requiredKeys?.length)
      body.append(
        el('small', '', 'Keys: ' + o.requiredKeys.map(group => group.join(' or ')).join(' + '))
      );
    const pts = objectivePoints(q, o.id);
    if (pts.length) {
      const b = el(
        'button',
        '',
        pts.some(p => p.candidate)
          ? '⌖ View possible location' + (pts.length > 1 ? 's' : '')
          : '⌖ View on map'
      );
      b.onclick = () => focusQuest(q, o.id);
      body.append(b);
    } else {
      const other = mappedElsewhere([o]);
      if (other) {
        const b = el('button', '', '⌖ View on ' + mapName(other.id) + ' ↗');
        b.title = 'Switch the tactical map to ' + mapName(other.id) + ' and show this objective';
        b.onclick = () => openQuestOnMap(q, other.id, o.id);
        body.append(b);
      } else body.append(el('small', '', 'No fixed ' + currentName + ' location in this dataset.'));
    }
    if (progress.target > 1) {
      const counter = el('div', 'objective-counter'),
        minus = el('button', '', '−'),
        value = el('strong', '', progress.value + ' / ' + progress.target),
        plus = el('button', '', '+');
      minus.setAttribute('aria-label', 'Decrease objective progress');
      plus.setAttribute('aria-label', 'Increase objective progress');
      minus.disabled = progress.value <= 0;
      plus.disabled = progress.value >= progress.target;
      const set = async next => {
        try {
          await changeProgress({
            type: 'objective-counter',
            id: o.id,
            value: next,
            target: progress.target,
            confirmed: next >= progress.target && progress.confirmed,
            source: 'manual'
          });
          renderDetail();
          renderMarkers();
        } catch {
          toast('Could not save the counter.', 'error');
        }
      };
      minus.onclick = () => set(Math.max(0, progress.value - 1));
      plus.onclick = () => set(Math.min(progress.target, progress.value + 1));
      counter.append(minus, value, plus);
      if (progress.source === 'ocr')
        counter.append(
          el(
            'small',
            progress.confirmed ? 'confirmed' : 'pending-review',
            progress.confirmed ? 'Confirmed from review' : 'OCR suggestion · confirm after raid'
          )
        );
      body.append(counter);
    }
    row.append(check, mark, body);
    section.append(row);
  });
  panel.append(section);
  const prerequisites = (q.requirements || [])
      .map(req => quests.find(x => x.id === requirementId(req)))
      .filter(Boolean),
    next = unlockedBy(q.id);
  if (prerequisites.length || next.length) {
    const chain = el('div', 'detail-section quest-chain');
    if (prerequisites.length) {
      chain.append(el('span', 'eyebrow', 'PREREQUISITES'));
      for (const item of prerequisites) {
        const b = el('button', 'chain-link', '← ' + item.name);
        b.onclick = () => selectQuest(item);
        chain.append(b);
      }
    }
    if (next.length) {
      chain.append(el('span', 'eyebrow', 'UNLOCKS NEXT'));
      for (const item of next.slice(0, 12)) {
        const b = el('button', 'chain-link', item.name + ' →');
        b.onclick = () => selectQuest(item);
        chain.append(b);
      }
    }
    const whole = el('button', 'chain-link chain-open', 'See the whole chain →');
    whole.title = 'Every quest before and after ' + q.name + ', by distance';
    whole.onclick = () => {
      renderChain(q);
      $('chain-dialog').showModal();
    };
    chain.append(whole);
    if (collectorPath().has(q.id))
      chain.append(el('span', 'pill kappa-path', 'Collector / Kappa path'));
    panel.append(chain);
  }
  const rewards = el('div', 'detail-section');
  rewards.append(el('div', 'section-title', 'REWARDS'));
  q.rewardSummary.forEach(r => rewards.append(el('div', 'reward', r)));
  panel.append(rewards);
  const notes = el('div', 'detail-section');
  notes.append(el('span', 'eyebrow', 'MY NOTES'));
  const textarea = el('textarea', 'quest-note');
  textarea.placeholder = 'Gear, route or reminder for this quest…';
  textarea.value = profile().questNotes?.[q.id] || '';
  let noteTimer;
  textarea.oninput = () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => {
      profile().questNotes ||= {};
      profile().questNotes[q.id] = textarea.value;
      await bridge.questMeta({ mode: data.mode, id: q.id, note: textarea.value });
    }, 400);
  };
  notes.append(textarea);
  panel.append(notes);
  panel.append(
    el(
      'p',
      'detail-note',
      (source(q) === 'logs'
        ? 'Quest status updated from the game logs. Objective counters need your confirmation or a reviewed Tasks screenshot.'
        : 'Manual quest status and objective counters.') +
        ' Saved separately for ' +
        data.mode.toUpperCase() +
        '. Quest data: ' +
        allData.generatedAt.slice(0, 10) +
        '. Possible item locations are candidates, not live loot.'
    )
  );
  describeBrief(q ? q.name + ' — quest brief' : 'Quest brief');
  /* Now, not next frame. The card is complete and something else may already
     have a frame pending from before it was built - and the pending one wins,
     because scheduleBriefAlign returns early when one is queued. That left the
     card 185px from where it belonged until a later, unrelated alignment
     happened to fix it. */
  if (briefAlignFrame) {
    cancelAnimationFrame(briefAlignFrame);
    briefAlignFrame = 0;
  }
  alignBrief();
}
function renderBattlepass() {
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
/* Panning only slides the viewBox, and every marker layer is drawn in map
 * coordinates, so the SVG carries them along for nothing. Sizes come from
 * `view.w` and clustering cells from the same, neither of which a pan changes,
 * and the decluttering is decided from distances between markers, which a
 * translation leaves identical.
 *
 * The one layer that genuinely depends on where you are is the loot one,
 * because it culls to the viewport - and that already runs on a debounce.
 *
 * So a drag needs the viewBox and nothing else. `setView()` stays the full
 * rebuild for everything that is not a pan: zooming, switching floors,
 * toggling a layer, selecting a quest.
 */
function panView() {
  $('map-svg').setAttribute('viewBox', [view.x, view.y, view.w, view.h].join(' '));
  scheduleLootRender();
}
/* Zooming does change what a rebuild would produce - marker sizes and the
 * clustering cells both come from `view.w` - so it cannot be skipped. It can
 * be deferred until you stop.
 *
 * Settling once per animation frame was already far better than once per wheel
 * event, but the rebuild is 24ms on a busy map and the frame is 16, so a
 * sustained zoom still dropped frames. Settling after the gesture instead
 * costs nothing per frame: the viewBox moves immediately and the SVG scales
 * the markers along with the map, then they resettle to their proper sizes and
 * clusters once the wheel goes quiet.
 *
 * The visible cost is that markers grow and shrink with the map while you are
 * zooming, which on a map reads as the map zooming rather than as a bug, and
 * clusters do not split until you stop.
 */
let zoomSettleTimer = 0;
function zoomView() {
  panView();
  clearTimeout(zoomSettleTimer);
  zoomSettleTimer = setTimeout(setView, 90);
}
function setView() {
  $('map-svg').setAttribute('viewBox', [view.x, view.y, view.w, view.h].join(' '));
  renderMarkers();
  renderKeycardDoors();
  renderDoors();
  renderSwitches();
  renderBosses();
  renderCustomMarkers();
  renderLandmarks();
  renderExtractLabels();
  renderPlayer();
  scheduleLootRender();
  renderBattlepass();
  scheduleDeclutter();
}
function resetView() {
  view = { x: 0, y: 0, w: W, h: H };
  setView();
}
function focusQuest(q, onlyId) {
  const pts = objectivePoints(q, onlyId);
  if (!pts.length) {
    toast(
      'This objective has no fixed ' +
        mapName(currentMapId) +
        ' location. Read the quest brief for its requirements.'
    );
    return;
  }
  const maps = pts.map(point);
  const minX = Math.min(...maps.map(p => p.x)),
    maxX = Math.max(...maps.map(p => p.x)),
    minY = Math.min(...maps.map(p => p.y)),
    maxY = Math.max(...maps.map(p => p.y));
  const w = Math.max(180, (maxX - minX) * 1.6),
    h = Math.max(100, (maxY - minY) * 1.6);
  view = { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h };
  applyFloor(floorFor(pts[0]));
  setView();
  const label = pts.length + ' point' + (pts.length === 1 ? '' : 's');
  $('focus-label').textContent = q.name + ' · ' + label;
  toast('Showing ' + q.name + ' · ' + label + ' on the map.');
}
/* The measured box of `#map-svg`, kept until the element actually resizes.
 * makeMarker() asks for the scale once per marker, and reading geometry
 * between DOM writes forces a full re-layout of the SVG each time - 7.57ms of
 * a 7.7ms renderMarkers, by the sampling profiler. Appending markers cannot
 * change this box, and panning and zooming move `view`, not the element. */
let mapSvgBox = null;
function markerScale() {
  if (!mapSvgBox) mapSvgBox = $('map-svg').getBoundingClientRect();
  return Math.max(view.w / mapSvgBox.width, view.h / mapSvgBox.height);
}
/* A count is a circle. An objective is a pin. And the pin says what you do
 * there.
 *
 * Three different meanings were all drawn as a ring with a number in it -
 * which quest this is, how many objectives are stacked on this spot, and how
 * many loot points are nearby - so on Woods with the Valuables preset the
 * quest you opened the map for was indistinguishable from a pile of
 * screwdrivers behind it. The user reported it by pointing at two of them and
 * saying one is a quest and the other is not.
 *
 * The shape carries the meaning now. A pin is somewhere you are going, and
 * its tip is the coordinate, which is also more honest than a circle centred
 * on it. Everything that counts something keeps its circle.
 *
 * What went in the head is the more useful half. The number that used to sit
 * there was an index into My Raid, so it meant nothing at all unless that
 * panel happened to be open - while the thing the map could never tell you,
 * and that you go to the map for, is what the point is *for*. Counted over
 * every mapped objective in the catalogue, seven verbs cover all 964 points:
 * find 40%, visit 26%, plant 19%, mark 12%, shoot 2%, and nine stragglers -
 * eight signal flares and one extraction - that turned out to be two more
 * verbs rather than a remainder. So the glyph is the verb, the colour is
 * which quest, and the number moved to a badge. The dot is a fallback that
 * nothing in the bundled data reaches.
 *
 * The glyphs are not meant to be learned from a legend - the quest brief's
 * objective rows carry the same five, so the map and the list teach each
 * other. Keep them in step if either changes.
 *
 * The one other teardrop on the map is the user's own marker, and it is
 * deliberately unlike this one: a solid magenta drop with a hole punched in
 * it, centred on its point rather than standing on it. Do not give a third
 * layer a pin - the whole value here is that the silhouette is the answer.
 */
const questPinPath = 'M0 0 C-3 -6.9 -11 -11.6 -11 -20 A11 11 0 1 1 11 -20 C11 -11.6 3 -6.9 0 0 Z';
const objectiveVerbs = {
  findQuestItem: 'find',
  findItem: 'find',
  visit: 'visit',
  mark: 'mark',
  plantItem: 'plant',
  plantQuestItem: 'plant',
  shoot: 'shoot',
  /* Every mapped `useItem` in all three catalogues is a signal flare - eight
     of them, from Airmail to the four in The Price of Independence - which is
     why the glyph is a flare rather than a generic "use something". If a
     catalogue refresh ever brings a useItem that is not a flare the glyph
     overstates it, though the objective text in the popup still says what it
     really is. Re-check with tools/ if that day comes. */
  useItem: 'signal',
  extract: 'extract'
};
const verbLabels = {
  find: 'Pick something up here',
  visit: 'Go and look here',
  mark: 'Place a marker here',
  plant: 'Leave something here',
  shoot: 'Something to kill here',
  signal: 'Fire a signal flare here',
  extract: 'Leave the raid here',
  /* Not a verb but a state, and it belongs in the same table because it is
     drawn in the same place and has to be as distinct from the seven as they
     are from each other. */
  done: 'Already done'
};
function objectiveVerb(objective) {
  return objectiveVerbs[objective && objective.type] || 'other';
}
/* Drawn in a box of about eleven units centred on the origin, so the caller
   places it and never has to know what a glyph is. Two to four strokes each:
   at the size a marker actually renders, a fifth stroke is a smudge. */
function verbGlyph(verb, color) {
  const line = (x1, y1, x2, y2) =>
    svg('line', {
      x1,
      y1,
      x2,
      y2,
      stroke: color,
      'stroke-width': 1.7,
      'stroke-linecap': 'round'
    });
  const stroke = (tag, attrs) =>
    svg(tag, {
      ...attrs,
      fill: 'none',
      stroke: color,
      'stroke-width': 1.7,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    });
  switch (verb) {
    case 'find':
      // a magnifier: there is an item here and you have to look for it
      return [stroke('circle', { cx: -1.1, cy: -1.1, r: 3.9 }), line(1.8, 1.8, 4.7, 4.7)];
    case 'visit':
      // an eye: go and look, nothing to carry
      return [
        stroke('path', { d: 'M-5.6 0 Q0 -4.4 5.6 0 Q0 4.4 -5.6 0 Z' }),
        svg('circle', { cx: 0, cy: 0, r: 1.7, fill: color })
      ];
    case 'mark':
      // a beacon: a marker you had to bring, planted, transmitting
      return [
        svg('circle', { cx: 0, cy: 3.1, r: 1.8, fill: color }),
        stroke('path', { d: 'M-3.1 0.4 A4 4 0 0 1 3.1 0.4' }),
        stroke('path', { d: 'M-5.5 -2.4 A7 7 0 0 1 5.5 -2.4' })
      ];
    case 'plant':
      // down onto a shelf: you are leaving something behind
      return [
        line(0, -5.2, 0, 1.4),
        stroke('polyline', { points: '-2.7,-1.4 0,1.6 2.7,-1.4' }),
        line(-4.4, 4.3, 4.4, 4.3)
      ];
    case 'shoot':
      // a crosshair, the one glyph nobody has to be taught
      return [
        stroke('circle', { cx: 0, cy: 0, r: 3.4 }),
        line(0, -6, 0, -4.4),
        line(0, 4.4, 0, 6),
        line(-6, 0, -4.4, 0),
        line(4.4, 0, 6, 0)
      ];
    case 'signal':
      // up, and a spark at the top: a flare is the one thing on this map you
      // send away from yourself rather than go to
      /* Eight rays off an empty centre. This was an up arrow with sparks over
         it first, and the two merged into a smudge at the size a marker really
         draws - the user asked what the icon was, which is the answer. A
         starburst has nothing to merge with: it degrades into a blob that is
         still recognisably a blob of rays. The centre stays empty so it cannot
         be read as the crosshair, which is a ring with a dot's worth of solid
         in the middle. */
      return [
        line(0, -6.2, 0, -2.2),
        line(0, 2.2, 0, 6.2),
        line(-6.2, 0, -2.2, 0),
        line(6.2, 0, 2.2, 0),
        line(-4.4, -4.4, -1.6, -1.6),
        line(4.4, 4.4, 1.6, 1.6),
        line(-4.4, 4.4, -1.6, 1.6),
        line(4.4, -4.4, 1.6, -1.6)
      ];
    case 'extract':
      // the same arrow the extract layer draws, because it is the same idea
      // and a second vocabulary for one thing is what this change is undoing
      return [
        /* Pulled down-left off the number badge, which sits on the same
           shoulder this arrow points at. */
        line(-4.4, 4.4, 2.6, -2.6),
        stroke('polyline', { points: '-0.4,-2.6 2.6,-2.6 2.6,0.4' })
      ];
    case 'done':
      // a tick: what you were supposed to do here stops mattering once you
      // have done it, so the verb gives way rather than being decorated
      return [stroke('polyline', { points: '-5,0.2 -1.6,3.8 5.2,-3.4' })];
    default:
      return [svg('circle', { cx: 0, cy: 0, r: 2.6, fill: color })];
  }
}
function questPin(g, color, candidate, number, stacked, verb) {
  /* The ground shadow is what stops a pin floating: without it the tip reads
     as the bottom of a balloon rather than as the spot itself. */
  g.append(svg('ellipse', { cx: 0, cy: 1.2, rx: 5, ry: 1.9, fill: '#000', opacity: '.42' }));
  /* A stack of pins, not one pin with a bigger number. Two objectives on one
     spot and quest number two would otherwise both be a pin reading "2" - the
     same collision this change exists to end, moved one layer in. Fanning two
     more silhouettes behind it makes the silhouette itself say "several",
     which survives being 14 pixels tall in a way a glyph would not. */
  if (stacked)
    for (const shift of ['translate(-8 -2.8) scale(.78)', 'translate(8 -2.8) scale(.78)'])
      g.append(
        svg('path', {
          d: questPinPath,
          transform: shift,
          fill: '#0e1719',
          'fill-opacity': '.95',
          stroke: color,
          'stroke-width': 2.6,
          'stroke-opacity': '.62',
          'stroke-linejoin': 'round'
        })
      );
  g.append(
    svg('path', {
      d: questPinPath,
      fill: '#0e1719',
      'fill-opacity': '.96',
      stroke: color,
      'stroke-width': 2,
      'stroke-linejoin': 'round',
      /* A possible location is one of several the quest might use, so its
         outline is broken - the same language the old marker used. */
      'stroke-dasharray': candidate ? '3.5 3' : ''
    })
  );
  g.append(svg('circle', { cx: 0, cy: -20, r: 7.6, fill: color, 'fill-opacity': '.15' }));
  g.append(svg('circle', { cx: 0, cy: 0, r: 1.8, fill: color }));
  if (stacked) {
    /* Several objectives on one spot can be several different verbs, so the
       head shows how many rather than picking one of them to stand for all. */
    const t = svg('text', {
      x: 0,
      y: -16.4,
      fill: color,
      'font-size': String(number).length > 1 ? 9 : 11,
      'font-weight': 700,
      'text-anchor': 'middle'
    });
    t.textContent = number;
    g.append(t);
    return g;
  }
  const head = svg('g', { transform: 'translate(0 -20)' });
  for (const shape of verbGlyph(verb, color)) head.append(shape);
  g.append(head);
  /* The quest number is a badge on the shoulder rather than the head, because
     a numeral in the middle of a marker is exactly what every count on this
     map looks like. On a badge it reads as an identity, which is what it is:
     the figure beside the matching card in My Raid. A quest that is not in
     that list has no index, and then it has no badge either. */
  if (number == null) return g;
  g.append(
    svg('circle', {
      cx: 9.4,
      cy: -27.6,
      r: 6.4,
      fill: '#0e1719',
      'fill-opacity': '.97',
      stroke: color,
      'stroke-width': 1.6
    })
  );
  const badge = svg('text', {
    x: 9.4,
    y: -25.2,
    fill: color,
    'font-size': String(number).length > 1 ? 6.4 : 7.8,
    'font-weight': 700,
    'text-anchor': 'middle'
  });
  badge.textContent = number;
  g.append(badge);
  return g;
}
function makeMarker(
  p,
  label,
  color,
  shape = 'extract',
  candidate = false,
  number = null,
  verb = 'other'
) {
  const pt = point(p),
    s = markerScale();
  const g = svg('g', {
    transform: `translate(${pt.x} ${pt.y}) scale(${s})`,
    class: 'map-marker',
    'data-kind': shape,
    tabindex: '0',
    role: 'button',
    'aria-label': label
  });
  if (shape === 'cluster') questPin(g, color, false, number, true, null);
  else if (shape === 'quest') questPin(g, color, candidate, number, false, verb);
  else {
    g.append(
      svg('rect', {
        x: -10,
        y: -10,
        width: 20,
        height: 20,
        rx: 5,
        fill: '#152322',
        stroke: color,
        'stroke-width': 1.3
      })
    );
    const t = svg('text', { x: 0, y: 4, fill: color, 'font-size': 13, 'text-anchor': 'middle' });
    t.textContent = shape === 'transit' ? '⇄' : '↗';
    g.append(t);
  }
  const title = svg('title');
  title.textContent = label;
  g.append(title);
  return g;
}
function showPopup(p) {
  const pop = $('map-popup');
  pop.replaceChildren();
  const close = el('button', '', '×');
  close.setAttribute('aria-label', 'Close marker details');
  close.onclick = () => (pop.hidden = true);
  pop.append(
    close,
    el('span', 'eyebrow', p.kind === 'transit' ? 'TRANSIT POINT' : 'EXTRACTION POINT'),
    el('strong', '', p.name),
    el(
      'small',
      '',
      p.category.replace('extract-', '').toUpperCase() +
        ' · elevation ' +
        p.position.y.toFixed(1) +
        ' m'
    )
  );
  if (p.transferItem)
    pop.append(
      el(
        'small',
        '',
        'Payment requirement in dataset: ' + p.transferItem.count.toLocaleString() + ' units.'
      )
    );
  if (p.switchIds?.length)
    pop.append(el('small', '', 'Requires activation. Check the in-game conditions.'));
  pop.append(el('small', '', 'Known location — availability is determined in-game for each raid.'));
  pop.hidden = false;
}
function showQuestCluster(entries) {
  const unique = [
      ...new Map(entries.map(entry => [entry.q.id + ':' + entry.p.objective.id, entry])).values()
    ],
    pop = $('map-popup');
  pop.replaceChildren();
  const close = el('button', 'icon-only popup-close');
  close.append(uiIcon('close'));
  close.setAttribute('aria-label', 'Close overlapping quests');
  close.onclick = () => (pop.hidden = true);
  pop.append(
    close,
    el('span', 'eyebrow', 'OVERLAPPING POINTS'),
    el('strong', '', unique.length + ' quest objectives here')
  );
  const list = el('div', 'cluster-list');
  for (const entry of unique) {
    const meta = questMarkerMeta(entry.q),
      button = el('button', 'cluster-choice'),
      number = el('span', 'cluster-number', String(meta.number || '•'));
    number.style.borderColor = meta.color;
    number.style.color = meta.color;
    const copy = el('span', 'cluster-copy');
    copy.append(el('strong', '', entry.q.name), el('small', '', entry.p.objective.description));
    button.append(number, copy);
    button.onclick = () => {
      pop.hidden = true;
      selectQuest(entry.q);
      focusQuest(entry.q, entry.p.objective.id);
    };
    list.append(button);
  }
  pop.append(list);
  pop.hidden = false;
}
function renderMarkers() {
  $('markers').replaceChildren();
  for (const p of pois) {
    let visible =
      p.category === 'transit'
        ? $('layer-transit').checked
        : p.category === 'extract-shared'
          ? $('layer-extract').checked || $('layer-scav').checked
          : p.category === 'extract-scav'
            ? $('layer-scav').checked
            : p.category === 'extract-pmc'
              ? $('layer-extract').checked
              : false;
    if (!visible) continue;
    const g = makeMarker(
      p.position,
      p.name,
      p.category === 'transit' || p.category === 'extract-scav' ? '#8abdd0' : '#97d5af',
      p.category === 'transit' ? 'transit' : 'extract'
    );
    g.onclick = e => {
      e.stopPropagation();
      showPopup(p);
    };
    g.onkeydown = e => {
      if (e.key === 'Enter') showPopup(p);
    };
    $('markers').append(g);
  }
  const shown = selected
    ? [selected]
    : myRaidOpen
      ? visibleRaidQuests()
      : quests.filter(q => status(q) === 'active');
  const threshold = 18 * markerScale(),
    clusters = [];
  for (const q of shown)
    for (const p of objectivePoints(q)) {
      /* Dropped here rather than at drawing time so the cluster counts are
         about what is left to do, not about what used to be here. */
      if (hideDoneObjectives && isDone(p.objective)) continue;
      const projected = point(p),
        cluster = clusters.find(
          item =>
            Math.hypot(item.projected.x - projected.x, item.projected.y - projected.y) <= threshold
        );
      if (cluster) cluster.entries.push({ q, p });
      else clusters.push({ projected, entries: [{ q, p }] });
    }
  for (const cluster of clusters) {
    const unique = [
      ...new Map(
        cluster.entries.map(entry => [entry.q.id + ':' + entry.p.objective.id, entry])
      ).values()
    ];
    if (unique.length > 1) {
      const finished = unique.filter(entry => isDone(entry.p.objective)).length,
        allFinished = finished === unique.length,
        g = makeMarker(
          unique[0].p,
          unique.length +
            ' overlapping quest objectives' +
            (finished ? ' (' + finished + ' already done)' : ''),
          allFinished ? doneColor : '#f4c980',
          'cluster',
          false,
          unique.length
        ),
        floors = unique.map(entry => floorFor(entry.p));
      if (allFinished) g.dataset.done = 1;
      g.setAttribute(
        'opacity',
        allFinished ? (floors.includes(floor) ? '.4' : '.26') : floors.includes(floor) ? '1' : '.55'
      );
      g.onclick = e => {
        e.stopPropagation();
        showQuestCluster(unique);
      };
      g.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showQuestCluster(unique);
        }
      };
      $('markers').append(g);
      continue;
    }
    const { q, p } = cluster.entries[0],
      meta = questMarkerMeta(q),
      /* isDone used to be consulted only when the quest was NOT in My Raid -
         which is exactly when you are not working on it. For the quests you
         are actually on, a finished objective drew the identical pin, and the
         map went on pointing at places you had already been. */
      finished = isDone(p.objective),
      color = finished ? doneColor : meta.number ? meta.color : '#f4c980',
      verb = finished ? 'done' : objectiveVerb(p.objective),
      g = makeMarker(
        p,
        (meta.number ? 'Quest ' + meta.number + ': ' : '') +
          q.name +
          ' — ' +
          p.objective.description +
          /* The glyph is the whole point of the head, so anything that reads
             the label rather than the picture has to be told the same thing. */
          (verbLabels[verb] ? ' (' + verbLabels[verb].toLowerCase() + ')' : ''),
        color,
        'quest',
        p.candidate,
        meta.number,
        verb
      ),
      f = floorFor(p);
    /* Quiet, not gone. Hiding it by default would lose the fact that the
       point is there at all, and the checkbox is for people who want that. */
    if (finished) g.dataset.done = 1;
    g.setAttribute('opacity', finished ? (floor === f ? '.4' : '.26') : floor === f ? '1' : '.55');
    g.onclick = e => {
      e.stopPropagation();
      selectQuest(q);
      toast(
        p.objective.description + ' · ' + (f === 'Ground_Level' ? 'Ground' : f.replaceAll('_', ' '))
      );
    };
    g.onkeydown = e => {
      if (e.key === 'Enter') selectQuest(q);
    };
    $('markers').append(g);
  }
}
const containerLayers = [
  ['medical', 'layer-container-medical', 'container-medical-count'],
  ['rations', 'layer-container-rations', 'container-rations-count'],
  ['technical', 'layer-container-technical', 'container-technical-count'],
  ['weapons', 'layer-container-weapons', 'container-weapons-count'],
  ['valuables', 'layer-container-valuables', 'container-valuables-count'],
  ['caches', 'layer-container-caches', 'container-caches-count']
];
const looseLayers = [
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
let lootCache = null;

function lootEntries() {
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
function lootMarkerAsset(entry) {
  if (entry.kind === 'container')
    return (
      'assets/loot/containers/' +
      (lootData.containerTypes?.[entry.type]?.icon || 'container_wooden-crate.png')
    );
  if (entry.items?.length === 1 && lootData.items?.[entry.items[0]])
    return 'assets/loot/items/' + entry.items[0] + '.webp';
  return 'assets/loot/categories/' + (lootData.categories?.[entry.category]?.icon || 'other.webp');
}
function lootMarkerLabel(entry) {
  if (entry.kind === 'container')
    return lootData.containerTypes?.[entry.type]?.label || entry.type.replaceAll('-', ' ');
  const items = (entry.items || []).map(id => lootData.items?.[id]?.name).filter(Boolean);
  return items.length === 1 ? items[0] : items.length + ' possible loose-loot items';
}
function popupClose(label) {
  const close = el('button', 'icon-only popup-close');
  close.append(uiIcon('close'));
  close.setAttribute('aria-label', label);
  close.onclick = () => ($('map-popup').hidden = true);
  return close;
}
function showLoot(entry) {
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
function showLootCluster(entries) {
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
    view = centeredView(center, nextWidth, (nextWidth * H) / W);
    pop.hidden = true;
    setView();
  };
  pop.append(action);
  pop.hidden = false;
}
function renderLoot() {
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
function scheduleLootRender() {
  clearTimeout(lootRenderTimer);
  lootRenderTimer = setTimeout(() => {
    renderLoot();
    scheduleDeclutter();
  }, 90);
}

/*
 * Deciding which marker gets the spot when two land on it.
 *
 * The map draws nine layers that know nothing about each other. On Customs with
 * all of them switched on that is 237 markers making 209 overlapping pairs -
 * very nearly one collision each - and because every layer draws at much the
 * same size, the one quest objective you opened the map for looked exactly like
 * a loose screwdriver behind it.
 *
 * Each layer clusters its own points already; what was missing was anything
 * deciding between layers. This ranks them once per render and quietens
 * whatever loses, rather than removing it: zoom in and the crowd separates, and
 * the marker comes back on its own.
 */
const markerRanks = [
  ['player', 0],
  ['custom-markers', 1],
  ['markers', 2],
  ['boss-markers', 3],
  ['keycard-doors', 4],
  ['door-markers', 5],
  ['switch-markers', 5],
  ['battlepass-markers', 6],
  ['loot-markers', 8]
];
// Extracts share a layer with quest objectives but not their importance.
const wayoutRank = 7;
// And an objective you have already finished has less than either.
const doneRank = 9;
// One green for finished work, the same the quest brief strikes a line in.
const doneColor = '#82c7a7';
let declutterFrame = 0,
  declutterAgain = 0;
function scheduleDeclutter() {
  cancelAnimationFrame(declutterFrame);
  clearTimeout(declutterAgain);
  declutterFrame = requestAnimationFrame(declutterMarkers);
  // Redrawing a layer replaces its markers and takes their ranking with them,
  // and the loot layer redraws on a debounce of its own. Running once more once
  // everything has settled costs a millisecond and saves the map from coming
  // back crowded after a layer lands late.
  declutterAgain = setTimeout(declutterMarkers, 160);
}
function declutterMarkers() {
  /* Clearing the class invalidates layout and reading a box forces it back,
     so doing both to one marker before moving to the next made every marker
     pay for a re-layout of the whole SVG - 4.76ms of a 4.8ms pass, by the
     sampling profiler. Every write first, then every read: one layout for the
     pass. Same values, same order, same ranking out. */
  const nodes = [];
  for (const [id, rank] of markerRanks) {
    const group = $(id);
    if (!group) continue;
    for (const node of group.children) nodes.push({ node, id, rank });
  }
  for (const item of nodes) item.node.classList.remove('crowded');
  const candidates = [];
  for (const { node, id, rank } of nodes) {
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const kind = node.dataset.kind;
    candidates.push({
      node,
      /* A finished objective is still drawn, so it still has a box, and a box
         that wins a spot pushes an outstanding objective aside - the opposite
         of the point. It ranks below the extracts it shares a layer with. */
      rank:
        id === 'markers'
          ? node.dataset.done
            ? doneRank
            : kind !== 'quest' && kind !== 'cluster'
              ? wayoutRank
              : rank
          : rank,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      reach: Math.max(box.width, box.height) / 2
    });
  }
  candidates.sort((a, b) => a.rank - b.rank);
  const kept = [];
  for (const candidate of candidates) {
    // The rule is simply that two markers may not overlap: quieten one as soon
    // as the centres are closer than the two radii together. Measured on
    // Customs with every layer on, that leaves 7 collisions where there were
    // 233, and still shows 112 of the 161 markers at full strength.
    const buried = kept.some(
      other =>
        Math.hypot(other.x - candidate.x, other.y - candidate.y) < other.reach + candidate.reach
    );
    if (buried) candidate.node.classList.add('crowded');
    else kept.push(candidate);
  }
}
function labDoorEntries() {
  if (currentMapId !== 'the-lab') return [];
  const cards = new Map(labKeycards.map(card => [card.id, card]));
  return allPois
    .filter(p => p.kind === 'locked-door')
    .flatMap(p => {
      const keyId = (p.keyIds || []).find(id => cards.has(id));
      return keyId ? [{ door: p, card: cards.get(keyId) }] : [];
    });
}
function showKeycardDoor(entry) {
  const { door, card } = entry,
    pop = $('map-popup');
  pop.replaceChildren();
  const close = el('button', 'icon-only popup-close');
  close.append(uiIcon('close'));
  close.setAttribute('aria-label', 'Close keycard door');
  close.onclick = () => (pop.hidden = true);
  const cardLine = el('div', 'keycard-popup-card'),
    icon = el('img', 'keycard-item-icon'),
    copy = el('span');
  icon.src = 'assets' + card.iconPath;
  icon.alt = card.name;
  copy.append(el('strong', '', card.label), el('small', '', card.name));
  cardLine.append(icon, copy);
  pop.append(
    close,
    el('span', 'eyebrow', 'LABS KEYCARD DOOR'),
    el('strong', '', card.room),
    cardLine,
    el('small', '', floorName(floorFor(door.position)) + ' · This card opens the marked door.')
  );
  pop.hidden = false;
}
// Locked doors. Every bundled POI file carries them with the ids of the keys
// that open them, and only Labs ever drew them. Key names come from
// data/keys.json, a 16 KB extract, so the map never has to parse the 2.6 MB
// price catalog to print "Dorm room 206 key".
// The key as the game draws it. Falls back to the outline glyph for keys with
// no bundled image and for grouped labels like "A key or B key".
function keyImage(id) {
  const entry = keyCatalog[id];
  if (!entry?.icon) return uiIcon('keycard');
  const image = el('img', 'key-icon');
  image.src = entry.icon;
  image.alt = '';
  image.loading = 'lazy';
  image.title = entry.name;
  image.onerror = () => image.replaceWith(uiIcon('keycard'));
  return image;
}
function keyIdsForName(name) {
  return Object.entries(keyCatalog)
    .filter(([, key]) => name.toLowerCase().includes(key.name.toLowerCase()))
    .map(([id]) => id);
}
function keyIconFor(name) {
  const ids = keyIdsForName(name);
  return ids.length === 1 ? keyImage(ids[0]) : uiIcon('keycard');
}
function keyName(id) {
  return keyCatalog[id]?.name || 'Unknown key';
}
function doorEntries() {
  const labCards = new Set(labKeycards.map(card => card.id));
  return allPois.filter(poi => {
    if (poi.kind !== 'locked-door') return false;
    // Labs keycard doors have their own layer with the card colours; drawing them
    // twice would just stack two markers on the same door.
    return !(currentMapId === 'the-lab' && (poi.keyIds || []).some(id => labCards.has(id)));
  });
}
function questsNeedingKey(id) {
  return quests
    .filter(q => (q.neededKeys || []).some(key => key.id === id) && status(q) !== 'completed')
    .map(q => q.name);
}
function showDoor(door) {
  const pop = $('map-popup');
  pop.replaceChildren();
  const close = el('button', 'icon-only popup-close');
  close.append(uiIcon('close'));
  close.setAttribute('aria-label', 'Close door');
  close.onclick = () => (pop.hidden = true);
  const ids = door.keyIds || [];
  pop.append(
    close,
    el('span', 'eyebrow', 'LOCKED DOOR'),
    (() => {
      const line = el('div', 'door-key-line');
      for (const id of ids) line.append(keyImage(id));
      line.append(el('strong', '', ids.map(keyName).join(' or ')));
      return line;
    })()
  );
  if (ids.length > 1) pop.append(el('p', 'door-note', 'Any one of these keys opens it.'));
  const wanted = [...new Set(ids.flatMap(questsNeedingKey))];
  if (wanted.length)
    pop.append(
      el(
        'p',
        'door-note',
        'Wanted by: ' +
          wanted.slice(0, 4).join(', ') +
          (wanted.length > 4 ? ' and ' + (wanted.length - 4) + ' more' : '')
      )
    );
  pop.append(
    el(
      'small',
      'door-note',
      floorName(floorFor(door.position)) + ' · from the bundled tarkov.dev map data'
    )
  );
  pop.hidden = false;
}
// Offers the door only when this map has one for that key, so the button never
// promises something the map cannot show.
function keyDoorButton(name) {
  const doors = doorsForKeyName(name);
  if (!doors.length) return null;
  const button = el('button', 'key-door-button');
  button.append(uiIcon('crosshair'));
  button.title =
    doors.length + ' door' + (doors.length === 1 ? '' : 's') + ' on ' + mapName(currentMapId);
  button.setAttribute('aria-label', 'Show the door for ' + name + ' on the map');
  button.onclick = event => {
    event.stopPropagation();
    showDoorsForKey(name);
  };
  return button;
}
function renderDoors() {
  const layer = $('door-markers');
  if (!layer) return;
  layer.replaceChildren();
  if (!mapDefinition || !$('layer-doors')?.checked) return;
  const scale = markerScale();
  for (const door of doorEntries()) {
    if (floorFor(door.position) !== floor) continue;
    const pt = point(door.position),
      label = (door.keyIds || []).map(keyName).join(' or '),
      g = svg('g', {
        transform: `translate(${pt.x} ${pt.y}) scale(${scale})`,
        class: 'map-marker door-map-marker',
        tabindex: '0',
        role: 'button',
        'aria-label': 'Locked door · ' + label
      });
    g.append(
      svg('circle', {
        r: 11,
        fill: '#141a1c',
        'fill-opacity': '.9',
        stroke: '#c6b28a',
        'stroke-width': 1.1
      })
    );
    // The marker wears the key's own game image when one is bundled.
    const doorIcon = keyCatalog[(door.keyIds || [])[0]]?.icon;
    if (doorIcon) {
      g.append(
        svg('image', {
          href: doorIcon,
          x: -8,
          y: -8,
          width: 16,
          height: 16,
          preserveAspectRatio: 'xMidYMid meet'
        })
      );
    } else {
      const glyph = svg('use', {
        href: 'assets/icons.svg#keycard',
        x: -7,
        y: -5,
        width: 14,
        height: 10
      });
      glyph.setAttribute('class', 'door-glyph');
      g.append(glyph);
    }
    g.onclick = event => {
      event.stopPropagation();
      showDoor(door);
    };
    g.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showDoor(door);
      }
    };
    layer.append(g);
  }
}
// Switches. The POIs carry what each one operates, and the chains are the part
// worth showing: D-2 Power Switch unlocks D-2 Door Switch, which unlocks the
// D-2 extract. Targets are resolved by id against the same map's POIs.
function switchEntries() {
  return allPois.filter(poi => poi.kind === 'switch');
}
function poiById(id) {
  return allPois.find(poi => poi.id === id) || null;
}
function switchEffects(control) {
  const verbs = { Unlock: 'Unlocks', Lock: 'Locks', Open: 'Opens', Close: 'Closes' };
  return (control.activates || []).map(step => {
    const target = poiById(step.targetId),
      verb = verbs[step.operation] || step.operation;
    if (!target) return verb + ' another ' + (step.targetKind || 'object') + ' on this map';
    const next = (target.activates || [])
      .map(onward => {
        const beyond = poiById(onward.targetId);
        return beyond
          ? (verbs[onward.operation] || onward.operation).toLowerCase() + ' ' + beyond.name
          : null;
      })
      .filter(Boolean);
    return (
      verb +
      ' ' +
      target.name +
      (target.kind === 'extract' ? ' (extract)' : '') +
      (next.length ? ', which ' + next.join(' and ') : '')
    );
  });
}
function showSwitch(control) {
  const pop = $('map-popup');
  pop.replaceChildren();
  const close = el('button', 'icon-only popup-close');
  close.append(uiIcon('close'));
  close.setAttribute('aria-label', 'Close switch');
  close.onclick = () => (pop.hidden = true);
  pop.append(close, el('span', 'eyebrow', 'SWITCH'), el('strong', '', control.name));
  const effects = switchEffects(control);
  for (const effect of effects) pop.append(el('p', 'switch-effect', effect));
  if (!effects.length)
    pop.append(el('p', 'door-note', 'The map data does not record what this one operates.'));
  pop.append(
    el(
      'small',
      'door-note',
      floorName(floorFor(control.position)) + ' · from the bundled tarkov.dev map data'
    )
  );
  pop.hidden = false;
}
function renderSwitches() {
  const layer = $('switch-markers');
  if (!layer) return;
  layer.replaceChildren();
  if (!mapDefinition || !$('layer-switches')?.checked) return;
  const scale = markerScale();
  for (const control of switchEntries()) {
    if (floorFor(control.position) !== floor) continue;
    const pt = point(control.position),
      g = svg('g', {
        transform: `translate(${pt.x} ${pt.y}) scale(${scale})`,
        class: 'map-marker switch-map-marker',
        tabindex: '0',
        role: 'button',
        'aria-label': 'Switch · ' + control.name
      });
    g.append(
      svg('circle', {
        r: 11,
        fill: '#141a1c',
        'fill-opacity': '.9',
        stroke: '#91b7d0',
        'stroke-width': 1.1
      })
    );
    g.append(svg('rect', { x: -3.5, y: -6, width: 7, height: 12, rx: 2.4, class: 'switch-glyph' }));
    g.append(svg('circle', { cx: 0, cy: -2.6, r: 1.7, class: 'switch-glyph-dot' }));
    g.onclick = event => {
      event.stopPropagation();
      showSwitch(control);
    };
    g.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showSwitch(control);
      }
    };
    layer.append(g);
  }
}
function doorsForKeyName(name) {
  const wanted = Object.entries(keyCatalog)
    .filter(([, key]) => name.toLowerCase().includes(key.name.toLowerCase()))
    .map(([id]) => id);
  if (!wanted.length) return [];
  return doorEntries().filter(door => (door.keyIds || []).some(id => wanted.includes(id)));
}
function showDoorsForKey(name) {
  const doors = doorsForKeyName(name);
  if (!doors.length) {
    toast('No door for ' + name + ' is mapped on ' + mapName(currentMapId) + '.');
    return;
  }
  $('layer-doors').checked = true;
  saveLayers();
  applyFloor(floorFor(doors[0].position));
  const points = doors.map(door => point(door.position)),
    minX = Math.min(...points.map(p => p.x)),
    maxX = Math.max(...points.map(p => p.x)),
    minY = Math.min(...points.map(p => p.y)),
    maxY = Math.max(...points.map(p => p.y)),
    w = Math.max(200, (maxX - minX) * 1.6),
    h = Math.max(130, (maxY - minY) * 1.6);
  view = { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h };
  setView();
  if (doors.length === 1) showDoor(doors[0]);
  toast(doors.length + ' door' + (doors.length === 1 ? '' : 's') + ' for ' + name + '.');
}
function renderKeycardDoors() {
  const markerLayer = $('keycard-doors'),
    labelLayer = $('keycard-labels');
  if (!markerLayer || !labelLayer) return;
  markerLayer.replaceChildren();
  labelLayer.replaceChildren();
  if (currentMapId !== 'the-lab' || !$('layer-lab-keycards')?.checked) return;
  const entries = labDoorEntries(),
    showNames = $('layer-lab-keycard-labels')?.checked,
    scale = markerScale(),
    totals = new Map();
  for (const entry of entries) totals.set(entry.card.id, (totals.get(entry.card.id) || 0) + 1);
  const seen = new Map();
  for (const entry of entries) {
    const { door, card } = entry,
      doorFloor = floorFor(door.position);
    if (doorFloor !== floor) continue;
    const pt = point(door.position),
      g = svg('g', {
        transform: `translate(${pt.x} ${pt.y}) scale(${scale})`,
        class: 'map-marker keycard-map-marker',
        tabindex: '0',
        role: 'button',
        'aria-label': card.name + ' opens ' + card.room
      });
    g.append(
      svg('circle', {
        r: 18,
        fill: '#101719',
        'fill-opacity': '.88',
        stroke: card.accent,
        'stroke-width': 1.2
      })
    );
    g.append(
      svg('image', {
        x: -15,
        y: -10,
        width: 30,
        height: 20,
        href: 'assets' + card.iconPath,
        preserveAspectRatio: 'xMidYMid meet'
      })
    );
    const order = (seen.get(card.id) || 0) + 1;
    seen.set(card.id, order);
    if (totals.get(card.id) > 1) {
      const badge = svg('g', { transform: 'translate(12 -12)' });
      badge.append(
        svg('circle', { r: 6, fill: '#0c1214', stroke: card.accent, 'stroke-width': 1 })
      );
      const number = svg('text', {
        y: 2.5,
        fill: '#f3f6f4',
        'font-size': 7,
        'font-weight': 800,
        'text-anchor': 'middle'
      });
      number.textContent = order;
      badge.append(number);
      g.append(badge);
    }
    const title = svg('title');
    title.textContent = card.name + ' — ' + card.room;
    g.append(title);
    g.onclick = e => {
      e.stopPropagation();
      showKeycardDoor(entry);
    };
    g.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showKeycardDoor(entry);
      }
    };
    markerLayer.append(g);
    if (showNames) {
      const label = svg('text', {
        x: pt.x,
        y: pt.y + 25 * scale,
        'text-anchor': 'middle',
        fill: card.accent,
        stroke: '#101719',
        'stroke-width': 3 * scale,
        'paint-order': 'stroke',
        'font-size': 8 * scale,
        'font-family': 'Consolas,monospace',
        'font-weight': 700,
        'letter-spacing': 0.25 * scale
      });
      label.textContent = card.label + (totals.get(card.id) > 1 ? ' ' + order : '');
      labelLayer.append(label);
    }
  }
}
function setMarkerPlacement(active) {
  markerAdding = active;
  $('add-marker').classList.toggle('active', active);
  $('marker-mode-hint').hidden = !active;
  $('map-viewport').classList.toggle('placing-marker', active);
}
function openMarkerEditor(position, marker = null) {
  markerDraftPosition = position;
  editingMarkerId = marker?.id || null;
  $('marker-dialog-title').textContent = marker ? 'Edit marker' : 'Add marker';
  $('marker-name').value = marker?.name || '';
  $('marker-note').value = marker?.note || '';
  $('marker-error').textContent = '';
  $('marker-dialog').showModal();
  requestAnimationFrame(() => $('marker-name').focus());
}
function closeMarkerEditor() {
  if ($('marker-dialog').open) $('marker-dialog').close();
  markerDraftPosition = null;
  editingMarkerId = null;
}
async function saveMarkerEditor(event) {
  event.preventDefault();
  const name = $('marker-name').value.trim(),
    note = $('marker-note').value.trim();
  if (!name) {
    $('marker-error').textContent = 'Give this marker a short name.';
    $('marker-name').focus();
    return;
  }
  if (!markerDraftPosition) {
    $('marker-error').textContent = 'Choose a place on the map again.';
    return;
  }
  const p = ensureRaidData(),
    current = p.customMarkers[currentMapId],
    previous = editingMarkerId ? current.find(item => item.id === editingMarkerId) : null,
    marker = {
      id: editingMarkerId || (crypto.randomUUID ? crypto.randomUUID() : 'marker-' + Date.now()),
      name: name.slice(0, 80),
      note: note.slice(0, 500),
      position: markerDraftPosition,
      createdAt: previous?.createdAt || Date.now()
    },
    next = editingMarkerId
      ? current.map(item => (item.id === editingMarkerId ? marker : item))
      : [...current, marker],
    button = $('save-marker');
  button.disabled = true;
  $('marker-error').textContent = '';
  try {
    await bridge.customMarkers({ mode: data.mode, map: currentMapId, markers: next });
    p.customMarkers[currentMapId] = next;
    closeMarkerEditor();
    renderCustomMarkers();
    toast(previous ? 'Marker updated.' : 'Marker added.');
  } catch (e) {
    $('marker-error').textContent = 'Could not save this marker. Try again.';
  } finally {
    button.disabled = false;
  }
}
function renderCustomMarkers() {
  $('custom-markers').replaceChildren();
  updateLayerCounts();
  if (!$('layer-custom')?.checked) return;
  for (const marker of ensureRaidData().customMarkers[currentMapId]) {
    const pt = point(marker.position),
      s = markerScale(),
      g = svg('g', {
        transform: `translate(${pt.x} ${pt.y}) scale(${s})`,
        class: 'map-marker custom-map-marker',
        tabindex: '0',
        role: 'button',
        'aria-label': marker.name
      });
    g.append(
      svg('path', {
        d: 'M 0 -13 C -8 -13 -11 -6 -9 0 C -7 6 0 14 0 14 C 0 14 7 6 9 0 C 11 -6 8 -13 0 -13 Z',
        fill: '#d8a6f0',
        stroke: '#25182c',
        'stroke-width': 2
      })
    );
    g.append(svg('circle', { cx: 0, cy: -4, r: 3, fill: '#25182c' }));
    const title = svg('title');
    title.textContent = marker.name;
    g.append(title);
    const open = () => {
      const pop = $('map-popup');
      pop.replaceChildren();
      const close = el('button', 'icon-only popup-close');
      close.append(uiIcon('close'));
      close.setAttribute('aria-label', 'Close marker');
      close.onclick = () => (pop.hidden = true);
      const actions = el('div', 'marker-popup-actions'),
        edit = el('button', '');
      edit.append(uiIcon('edit'), el('span', '', 'Edit'));
      edit.onclick = () => {
        pop.hidden = true;
        openMarkerEditor(marker.position, marker);
      };
      const remove = el('button', 'danger-link');
      remove.append(uiIcon('trash'), el('span', '', 'Delete'));
      remove.onclick = async () => {
        const next = ensureRaidData().customMarkers[currentMapId].filter(
          item => item.id !== marker.id
        );
        remove.disabled = true;
        try {
          await bridge.customMarkers({ mode: data.mode, map: currentMapId, markers: next });
          ensureRaidData().customMarkers[currentMapId] = next;
          pop.hidden = true;
          renderCustomMarkers();
          toast('Marker deleted.');
        } catch {
          remove.disabled = false;
          toast('Could not delete the marker.', 'error');
        }
      };
      actions.append(edit, remove);
      pop.append(close, el('span', 'eyebrow', 'MY MARKER'), el('strong', '', marker.name));
      if (marker.note) pop.append(el('small', '', marker.note));
      pop.append(actions);
      pop.hidden = false;
    };
    g.onclick = e => {
      e.stopPropagation();
      open();
    };
    g.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    };
    $('custom-markers').append(g);
  }
}
const landmarksByMap = {
  customs: [
    ['DORMS', 201, 153],
    ['BIG RED', -204, -107],
    ['NEW GAS', 359, 53],
    ['OLD GAS', 309, -174],
    ['FORTRESS', 209, -137],
    ['CRACKHOUSE', 100, -107],
    ['CONSTRUCTION', 78, -8],
    ['RAIL BRIDGE', -110, -120],
    ['BOILERS', 570, -95]
  ],
  reserve: [
    ['WHITE QUEEN · DOME', -10, 180, '♕', 'white'],
    ['WHITE PAWN', -123, 96, '♙', 'white'],
    ['BLACK PAWN', -164, 53, '♟', 'black'],
    ['BLACK BISHOP', -136, -11, '♝', 'black'],
    ['WHITE BISHOP', -69, -32, '♗', 'white'],
    ['WHITE KING', -52, 21, '♔', 'white'],
    ['BLACK KNIGHT', 18, -15, '♞', 'black'],
    ['WHITE KNIGHT', 80, -37, '♘', 'white']
  ]
};
// Danger zones. The bundled tarkov.dev POIs carry an outline polygon for every
// minefield, sniper zone and mortar zone, and nothing drew them: 338 minefields
// on Lighthouse alone. They are painted straight onto the artwork, below every
// marker layer, and never take pointer events - a map covered in polygons that
// swallow drags would be worse than no map.
const hazardKinds = [
  {
    type: 'minefield',
    key: 'hazardMinefield',
    control: 'layer-hazard-minefield',
    label: 'Minefield'
  },
  { type: 'sniper', key: 'hazardSniper', control: 'layer-hazard-sniper', label: 'Sniper zone' },
  { type: 'mortar', key: 'hazardMortar', control: 'layer-hazard-mortar', label: 'Mortar zone' },
  { type: 'hazard', key: 'hazardHazard', control: 'layer-hazard-hazard', label: 'Hazard' }
];
function hazardsOfType(type) {
  return allPois.filter(poi => poi.kind === 'hazard' && (poi.hazardType || 'hazard') === type);
}
function renderHazards() {
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
// The hand-placed landmark list only ever covered Customs and Reserve, so the
// Landmarks checkbox did nothing on the other eleven maps. Boss zones and BTR
// stops in the bundled POIs carry real place names ("Kaban · Car Dealership",
// "Rodina Cinema"), so the rest of the maps can be labelled from data. Names
// that read like internal identifiers are dropped rather than shown: Terminal
// and Icebreaker would otherwise be captioned 1BD1PortAmbush1 and Mash_t1.
const internalLabel = /_|\d|[a-z][A-Z]/;
// Case matters for the camelCase test above, so the vague words get a separate
// case-insensitive regex: an /i flag on that one would make [a-z][A-Z] match any
// two letters and reject every name.
const vagueLabel = /\b(spawn|ambush|snipe|zone|any)\b/i;
const floorLabel = /^(first|second|third|fourth|ground)\s+(floor|level)$|^basement$/i;
function landmarkKey(name) {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function derivedLandmarks() {
  if (!allPois.length) return [];
  // Curated names are matched loosely, so a hand-placed NEW GAS also covers the
  // catalogue name New Gas Station. Derived names are matched exactly: Sawmill and
  // Old Sawmill are two different places in Woods and both belong on the map.
  const curated = (landmarksByMap[currentMapId] || []).map(item => landmarkKey(item[0]));
  const taken = new Set();
  const out = [];
  for (const poi of allPois) {
    let label = null,
      boss = null,
      detail = null;
    if (poi.kind === 'boss-zone') {
      label = poi.name.includes('·') ? poi.name.split('·').pop().trim() : null;
      boss = poi.bossName;
      if (label && poi.bossName)
        detail =
          poi.bossName +
          ' spawns here' +
          (poi.spawnChance ? ' · ' + Math.round(poi.spawnChance * 100) + '% chance' : '');
    } else if (poi.kind === 'btr') {
      label = poi.name;
      detail = 'BTR stop';
    }
    if (
      !label ||
      label.length < 3 ||
      internalLabel.test(label) ||
      vagueLabel.test(label) ||
      floorLabel.test(label)
    )
      continue;
    const key = landmarkKey(label);
    if (taken.has(key)) continue;
    if (curated.some(name => name.includes(key) || key.includes(name))) continue;
    taken.add(key);
    out.push({ label: label.toUpperCase(), position: poi.position, detail, boss });
  }
  return out;
}
function landmarkText(name, position, detail) {
  const scale = markerScale(),
    p = point(position),
    node = svg('text', {
      x: p.x,
      y: p.y - 15 * scale,
      'text-anchor': 'middle',
      fill: '#e2e9d7',
      stroke: '#183034',
      'stroke-width': 3 * scale,
      'paint-order': 'stroke',
      'font-size': 9 * scale,
      'font-family': 'Consolas,monospace',
      'letter-spacing': 0.7 * scale
    });
  node.textContent = name;
  if (detail) {
    const caption = svg('title');
    caption.textContent = detail;
    node.append(caption);
  }
  return node;
}
// Boss spawns. These were first drawn as part of the landmark labels, which hid
// them wherever the label lost: Reshala vanished from the Customs dorms because
// a hand-placed DORMS label won the name, and Tagilla never appeared on Factory
// at all because his zone is called "Any scav spawn". The portraits belong to
// the zones, not to the captions, so they get their own layer.
function bossZones() {
  return allPois.filter(poi => poi.kind === 'boss-zone' && poi.bossName);
}
function bossGroups() {
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
function bossChance(zones) {
  const table = bossSpawnRates?.modes?.[data.mode]?.[currentMapId];
  let best = 0;
  for (const zone of zones) {
    const published = table?.[zone.bossId];
    best = Math.max(best, typeof published === 'number' ? published : zone.spawnChance || 0);
  }
  return best > 0 ? Math.round(best * 100) + '% chance' : null;
}
function bossRateNote() {
  if (!bossSpawnRates) return null;
  if (data.mode === 'seasonal' && bossSpawnRates.seasonalSource === 'pvp')
    return 'Seasonal rates are not published, so this is the PvP figure.';
  return 'Rate for the ' + itemModeName() + ' mode.';
}
function showBoss(group) {
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
function renderBosses() {
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
function renderLandmarks() {
  $('landmarks').replaceChildren();
  if (!$('layer-labels').checked) return;
  const scale = markerScale();
  for (const [name, x, z, piece, tone] of landmarksByMap[currentMapId] || []) {
    const p = point({ x, z });
    if (!piece) {
      $('landmarks').append(landmarkText(name, { x, z }));
      continue;
    }
    const width = Math.max(78, name.length * 5.2 + 30),
      light = tone === 'white',
      g = svg('g', {
        transform: `translate(${p.x} ${p.y}) scale(${scale})`,
        class: 'chess-landmark',
        'aria-label': name
      });
    g.append(
      svg('rect', {
        x: -width / 2,
        y: -10,
        width,
        height: 20,
        rx: 5,
        fill: '#0b1719',
        'fill-opacity': 0.88,
        stroke: light ? '#dfe4dc' : '#91a09c',
        'stroke-width': 1
      })
    );
    g.append(
      svg('circle', {
        cx: -width / 2 + 11,
        cy: 0,
        r: 7,
        fill: light ? '#e7ebe3' : '#182326',
        stroke: light ? '#69736f' : '#d2d9d4',
        'stroke-width': 1.2
      })
    );
    const icon = svg('text', {
      x: -width / 2 + 11,
      y: 4,
      'text-anchor': 'middle',
      fill: light ? '#172023' : '#edf0ea',
      'font-size': 12,
      'font-family': 'Segoe UI Symbol,serif'
    });
    icon.textContent = piece;
    g.append(icon);
    const label = svg('text', {
      x: -width / 2 + 23,
      y: 3.4,
      fill: '#edf0ea',
      'font-size': 8.2,
      'font-family': 'Consolas,monospace',
      'font-weight': 700,
      'letter-spacing': 0.45
    });
    label.textContent = name;
    g.append(label);
    $('landmarks').append(g);
  }
  for (const place of derivedLandmarks())
    $('landmarks').append(landmarkText(place.label, place.position, place.detail));
}
function renderExtractLabels() {
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
function focusRaid(list) {
  const pts = list.flatMap(q => objectivePoints(q));
  if (!pts.length) return;
  const mapped = pts.map(point),
    minX = Math.min(...mapped.map(p => p.x)),
    maxX = Math.max(...mapped.map(p => p.x)),
    minY = Math.min(...mapped.map(p => p.y)),
    maxY = Math.max(...mapped.map(p => p.y));
  const w = Math.max(260, (maxX - minX) * 1.25),
    h = Math.max(150, (maxY - minY) * 1.25);
  view = { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h };
  applyFloor(baseFloor());
  setView();
}
/* Which of the active quests on this map actually send you somewhere.
 *
 * Measured across this profile, 53 of 89 My Raid rows - 60% - draw nothing
 * on the map at all: kill counts, extractions, hand-ins. They are correctly
 * active and worth knowing about, but they sat mixed in with the ones that
 * name a place, so the glance you take before a raid was ten rows deep to
 * find the three that tell you where to go. On Lighthouse it was eleven of
 * seventeen.
 */
function questHasPointsHere(q) {
  return objectivePoints(q).length > 0;
}
/* And of the ones that do: can this quest be finished without going
 * anywhere else? A quest is answered here when no objective it still needs
 * demands a different map. On Streets that is one quest in six, which is
 * the sort of thing you want to know before you load in rather than after.
 *
 * An objective with no mapIds at all is unconstrained - "survive and
 * extract", "hand over to the trader" - so it never blocks. An optional one
 * does not block either, by definition.
 */
function elsewhereMaps(q) {
  const needed = new Set();
  for (const o of q.objectives) {
    if (o.optional || isDone(o)) continue;
    const ids = o.mapIds || [];
    if (!ids.length || ids.includes(currentMapId)) continue;
    for (const id of ids) if (mapDefinitions.some(m => m.id === id)) needed.add(id);
  }
  return [...needed];
}
function renderMyRaid(focus = false) {
  const currentName = mapName(currentMapId),
    active = activeMapQuests(),
    visible = visibleRaidQuests(),
    hidden = hiddenOnCurrentMap(),
    pts = visible.flatMap(q => objectivePoints(q)),
    p = ensureRaidData();
  const panel = $('details');
  panel.replaceChildren();
  const box = el('div', 'active-summary');
  box.append(el('span', 'eyebrow', 'MY RAID'), el('h2', '', active.length + ' on ' + currentName));
  const goCount = active.filter(questHasPointsHere).length;
  box.append(
    el(
      'p',
      'raid-stats',
      goCount +
        ' with somewhere to go · ' +
        pts.length +
        ' map point' +
        (pts.length === 1 ? '' : 's') +
        (visible.length === active.length ? '' : ' · ' + visible.length + ' shown')
    )
  );
  if (!active.length)
    box.append(
      el(
        'p',
        '',
        'No active ' +
          currentName +
          ' quests are known yet. Update the logs or mark a quest Active manually.'
      )
    );
  if (active.length)
    box.append(el('p', 'raid-help', 'Use each checkbox to show or hide that quest on the map.'));
  /* Two groups, the useful one first. The heading carries the count so the
     split is readable without counting rows, and the second group says what
     its quests are rather than what they are not - "no fixed map point" on
     every row told you the same thing eleven times. */
  const goSomewhere = active.filter(questHasPointsHere),
    ticksUp = active.filter(q => !questHasPointsHere(q));
  const card = q => {
    const meta = questMarkerMeta(q),
      row = el('div', 'raid-quest-card' + (hidden.has(q.id) ? ' muted-card' : '')),
      toggle = el('input');
    toggle.type = 'checkbox';
    toggle.checked = !hidden.has(q.id);
    toggle.setAttribute('aria-label', 'Show ' + q.name + ' on map');
    toggle.onchange = () => {
      if (toggle.checked) hidden.delete(q.id);
      else hidden.add(q.id);
      p.raidHidden[currentMapId] = [...hidden];
      saveRaidPreferences();
      renderMarkers();
      renderMyRaid(false);
    };
    const number = el('span', 'raid-number', String(meta.number));
    number.style.borderColor = meta.color;
    number.style.color = meta.color;
    const open = el('button', 'raid-quest-open');
    open.append(el('strong', '', q.name), el('small', '', q.traderName));
    const floors = [...new Set(objectivePoints(q).map(p => floorFor(p)))].map(floorName);
    const points = objectivePoints(q).length;
    /* Under a heading that already reads NO FIXED LOCATION, a line on every
       row saying "No fixed map point" is the same sentence eleven times. The
       group says it once; the row says where to go, or nothing. */
    if (points)
      open.append(
        el(
          'small',
          'raid-floor',
          points +
            ' map point' +
            (points === 1 ? '' : 's') +
            (floors.length ? ' · ' + floors.join(', ') : '')
        )
      );
    open.onclick = () => {
      selectQuest(q);
      if (points) focusQuest(q);
    };
    /* The one thing the map cannot tell you by drawing: whether finishing
       this quest means coming back on another map. Only said where it is
       true - a chip on every row would be wallpaper. */
    const elsewhere = elsewhereMaps(q);
    if (points && !elsewhere.length) open.append(el('span', 'raid-flag', 'CAN FINISH HERE'));
    else if (elsewhere.length)
      open.append(
        el(
          'small',
          'raid-elsewhere',
          /* Two names is a plan; seven is noise. "Is This a Reference?" wants a
             camera on every map in the game, and spelling all seven out told
             you less than the count does. */
          elsewhere.length > 2
            ? 'Also needs ' + elsewhere.length + ' other maps'
            : 'Also needs ' + elsewhere.map(mapName).join(' and ')
        )
      );
    row.append(toggle, number, open);
    return row;
  };
  const group = (label, list, note) => {
    if (!list.length) return;
    const head = el('div', 'raid-group');
    head.append(el('span', 'eyebrow', label), el('span', 'count', String(list.length)));
    box.append(head);
    if (note) box.append(el('small', 'raid-group-note', note));
    for (const q of list) box.append(card(q));
  };
  group('PLACES TO GO', goSomewhere);
  group(
    'NO FIXED LOCATION',
    ticksUp,
    'Kills, extractions and hand-ins. They count while you play, so there is nothing to walk to.'
  );
  panel.append(box);
  const kit = raidKit(visible);
  if (kit.keys.length || kit.carry.length) {
    const gear = el('div', 'detail-section raid-kit'),
      title = el('div', 'section-title');
    title.append(
      el('span', 'eyebrow', 'BRING TO RAID'),
      el('span', 'count', String(kit.keys.length + kit.carry.length))
    );
    gear.append(title);
    const line = (entry, iconName, prefix, action) => {
      const row = el('div', 'raid-kit-row' + (entry.optional ? ' optional-requirement' : '')),
        head = el('div', 'raid-kit-head');
      head.append(
        typeof iconName === 'string' ? uiIcon(iconName) : iconName,
        el('strong', '', (prefix || '') + entry.label)
      );
      if (action) head.append(action);
      row.append(
        head,
        el(
          'small',
          '',
          [...entry.quests].join(' · ') + (entry.optional ? ' · optional objective' : '')
        )
      );
      gear.append(row);
    };
    kit.keys.forEach(entry => line(entry, keyIconFor(entry.label), '', keyDoorButton(entry.label)));
    kit.carry.forEach(entry => line(entry, 'tag', entry.action + ': '));
    gear.append(
      el(
        'small',
        'raid-kit-note',
        'From the objectives still open on ' + currentName + ' for the quests shown above.'
      )
    );
    panel.append(gear);
  }
  $('focus-label').textContent =
    'My Raid · ' + pts.length + ' map point' + (pts.length === 1 ? '' : 's');
  describeBrief('My Raid on ' + currentName);
  if (focus) focusRaid(visible);
}
function showActiveQuests() {
  const currentName = mapName(currentMapId),
    active = activeMapQuests();
  myRaidOpen = true;
  selected = null;
  setDetailsCollapsed(false);
  $('map-filter').value = currentMapId;
  // Only narrow to Active when there is something active to show. On a map
  // with no active quest this used to empty the journal and leave the filter
  // changed, so the button that means "what am I doing this raid" answered by
  // hiding all 503 quests behind "No quests match these filters".
  if (active.length) $('status-filter').value = 'active';
  renderList();
  renderMyRaid(true);
  renderMarkers();
  toast(
    active.length
      ? `My Raid: ${active.length} active ${currentName} quest${active.length === 1 ? '' : 's'}.`
      : 'No active ' + currentName + ' quests are known yet.'
  );
}
function updateLayerChildren() {
  $('layer-pmc-extract-labels').disabled = !$('layer-extract').checked;
  $('layer-scav-extract-labels').disabled = !$('layer-scav').checked;
  $('layer-transit-labels').disabled = !$('layer-transit').checked;
  $('layer-lab-keycard-labels').disabled = !$('layer-lab-keycards').checked;
}
function updateMapSpecificLayers() {
  const labs = currentMapId === 'the-lab';
  $('layer-lab-keycards-row').hidden = !labs;
  $('layer-lab-keycard-labels-row').hidden = !labs;
}
function setLayerCount(id, count) {
  const badge = $(id);
  badge.textContent = count > 1 ? count : '';
  badge.hidden = count <= 1;
}
function setLootLayerAvailability(controlId, countId, count) {
  const input = $(controlId),
    row = input?.closest('label');
  if (input) input.disabled = count === 0;
  if (row) row.hidden = count === 0;
  setLayerCount(countId, count);
}
function updateHazardCounts() {
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
function updateLayerCounts() {
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
function layerSettings() {
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
    ...Object.fromEntries(hazardKinds.map(kind => [kind.key, $(kind.control).checked]))
  };
  for (const [key, id] of [...containerLayers, ...looseLayers])
    settings[id.replace(/^layer-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] =
      $(id).checked;
  return settings;
}
async function saveLayers() {
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
function renderAllMapLayers() {
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
function applyLayerPreset(name) {
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
function renderPlayer() {
  $('player').replaceChildren();
  if (!currentFix) return;
  const pt = point(currentFix),
    s = markerScale(),
    stale = Date.now() - currentFix.observedAt > 60000;
  const g = svg('g', {
    transform: `translate(${pt.x} ${pt.y}) scale(${s})`,
    opacity: stale ? '.55' : '1'
  });
  g.append(
    svg('circle', {
      r: 20,
      fill: '#f3e9c9',
      'fill-opacity': '.1',
      stroke: '#ede7ce',
      'stroke-width': 1
    })
  );
  if (currentFix.heading !== null)
    g.append(
      svg('path', {
        d: 'M 0 -24 L -6 -12 L 6 -12 Z',
        fill: '#fff1bd',
        transform: 'rotate(' + (currentFix.heading - (mapDefinition.coordinateRotation || 0)) + ')'
      })
    );
  g.append(svg('circle', { r: 6, fill: '#fff1bd', stroke: '#303326', 'stroke-width': 2 }));
  $('player').append(g);
}
function updateCompass() {
  const rotation = mapDefinition?.coordinateRotation || 0;
  $('north-arrow').style.transform = `rotate(${-rotation}deg)`;
}
/* Where the middle of the map actually is, as a fraction of the viewport.
 *
 * The rail and, when it is open, the quest brief lie over the left of the
 * map, so the geometric centre of the viewport is underneath them. Framing a
 * quest objective there put the one thing you asked to see behind the glass.
 * This returns the centre of the strip you can see, which is 0.5 again as soon
 * as nothing is covering anything - the narrow layouts included.
 */
function visibleCentreFraction() {
  const viewport = $('map-viewport');
  if (!viewport) return 0.5;
  const frame = viewport.getBoundingClientRect();
  if (!frame.width) return 0.5;
  let covered = frame.left;
  for (const selector of ['.sidebar', '#details']) {
    const panel = document.querySelector(selector);
    if (!panel) continue;
    const style = getComputedStyle(panel);
    if (style.display === 'none' || style.visibility === 'hidden' || +style.opacity === 0) continue;
    const box = panel.getBoundingClientRect();
    // only panels lying over the map's left edge, not ones beside it
    if (box.left <= covered + 24 && box.right > covered) covered = box.right;
  }
  const middle = (covered + frame.right) / 2;
  const fraction = (middle - frame.left) / frame.width;
  return Math.min(Math.max(fraction, 0.5), 0.85);
}
function centeredView(p, w = view.w, h = view.h) {
  const fx = visibleCentreFraction();
  return {
    x: w >= W ? (W - w) / 2 : Math.max(0, Math.min(W - w, p.x - w * fx)),
    y: h >= H ? (H - h) / 2 : Math.max(0, Math.min(H - h, p.y - h / 2)),
    w,
    h
  };
}
function centerPlayer() {
  if (!currentFix) {
    toast('Take a new in-game screenshot after connecting.');
    return;
  }
  view = centeredView(point(currentFix));
  applyFloor(floorFor(currentFix));
  setView();
}
function updatePosition() {
  const p = observer.position;
  renderLogDiagnostics();
  const knownMap = p?.map === currentMapId;
  const manuallyConfirmed = p && confirmedFix === p.observedAt;
  currentFix = p && (knownMap || manuallyConfirmed) ? p : null;
  if (observer.error) {
    $('connection-title').textContent = 'Check your connection';
    $('connection-sub').textContent = observer.error;
  } else if (observer.connected) {
    $('connection-title').textContent = 'Listening for screenshots';
    $('connection-sub').textContent =
      observer.screenshotCount +
      ' files · ' +
      (observer.logsConnected
        ? profile().questSync?.lastScanAt
          ? 'logs read ' + whenBriefly(profile().questSync.lastScanAt)
          : 'raid logs connected'
        : 'map confirmation needed');
  } else {
    $('connection-title').textContent = 'Ready when you are';
    $('connection-sub').textContent = 'Connect your screenshots folder';
  }
  $('connection-dot').style.background =
    observer.connected && !observer.error ? '#82c7a7' : '#e5bc74';
  if (p && !knownMap && !manuallyConfirmed) {
    $('position-value').textContent = p.map
      ? 'Screenshot map: ' + mapName(p.map) + ' · select that location'
      : 'Map unconfirmed — click to confirm ' + mapName(currentMapId);
    $('position-age').textContent = '';
    $('position-value').style.pointerEvents = p.map ? 'none' : 'auto';
    $('position-value').style.cursor = p.map ? 'default' : 'pointer';
    $('position-value').onclick = () => {
      if (
        !p.map &&
        window.confirm(
          'Was this new screenshot taken on ' +
            mapName(currentMapId) +
            '? Only confirm if you know the map matches.'
        )
      ) {
        confirmedFix = p.observedAt;
        updatePosition();
      }
    };
  } else if (currentFix) {
    $('position-value').textContent =
      'X ' + p.x.toFixed(1) + ' · Y ' + p.y.toFixed(1) + ' · Z ' + p.z.toFixed(1);
    $('position-value').onclick = null;
    if (p.observedAt !== lastFixTime) {
      lastFixTime = p.observedAt;
      if (data.settings.autoFollow) centerPlayer();
    }
  } else {
    $('position-value').textContent =
      observer.raid === 'ended'
        ? 'Raid ended · waiting for a new screenshot'
        : 'Waiting for an in-game screenshot';
    $('position-age').textContent = '';
    $('position-value').onclick = null;
  }
  updateAge();
  renderPlayer();
}
function updateAge() {
  if (!currentFix) return;
  const seconds = Math.max(0, Math.floor((Date.now() - currentFix.observedAt) / 1000));
  $('position-age').textContent =
    seconds < 60 ? seconds + 's ago' : Math.floor(seconds / 60) + 'm ago';
  $('position-label').textContent =
    seconds > 60 ? 'LAST RECORDED POSITION · STALE' : 'LAST RECORDED POSITION';
  renderPlayer();
}
function updateActivityBadge() {
  const badge = $('activity-count');
  badge.textContent = activityUnread;
  badge.hidden = !activityUnread;
}
function renderActivity() {
  const list = $('activity-list'),
    history = profile().questSync?.history || [],
    integrity = allData?.integrity || {},
    knownIds = new Set(quests.flatMap(q => [q.id, ...(q.sourceQuestIds || [])])),
    unknownIds = Object.keys(profile().quests || {}).filter(id => !knownIds.has(id));
  list.replaceChildren();
  $('activity-profile').textContent =
    (data.mode === 'seasonal' ? 'Seasonal · Kord Breach' : data.mode.toUpperCase()) + ' profile';
  $('catalog-integrity').textContent =
    (allData?.localOverride ? 'Local catalog' : 'Bundled catalog') +
    ' · ' +
    (integrity.quests ?? quests.length) +
    ' quests · ' +
    (integrity.objectives ?? quests.reduce((n, q) => n + q.objectives.length, 0)) +
    ' objectives · ' +
    (integrity.mapPoints ?? '—') +
    ' map points · ' +
    (unknownIds.length
      ? unknownIds.length +
        ' quest' +
        (unknownIds.length === 1 ? '' : 's') +
        ' in your progress that this catalog does not list'
      : 'all detected quests recognized');
  // Those quests used to be called "newer", which is wrong: the logs that
  // carry them go back to earlier game versions and earlier seasons, and
  // tarkov.dev publishes only what the current build has. Naming the trader
  // and the date is the most the data allows, so that is what is shown.
  const unknownPanel = $('catalog-unknown');
  if (unknownPanel) {
    unknownPanel.replaceChildren();
    unknownPanel.hidden = !unknownIds.length;
    if (unknownIds.length) {
      const states = {};
      for (const id of unknownIds)
        states[profile().quests[id]] = (states[profile().quests[id]] || 0) + 1;
      unknownPanel.append(
        el(
          'p',
          'unknown-note',
          Object.entries(states)
            .map(([state, count]) => count + ' ' + state)
            .join(' · ') +
            '. They come from your game logs but no bundled catalog names them, so they are left out of the counts. Quests removed in an earlier patch or event tasks tarkov.dev has not published both land here.'
        )
      );
      for (const entry of (unknownQuestDetails || []).slice(0, 8)) {
        const row = el('div', 'unknown-quest'),
          trader = entry.trader && traderCatalog[entry.trader];
        if (trader) {
          const portrait = el('img', 'unknown-quest-portrait');
          portrait.src = trader.image;
          portrait.alt = '';
          portrait.onerror = () => portrait.remove();
          row.append(portrait);
        }
        const copy = el('div');
        copy.append(el('strong', '', trader ? trader.name : 'Unknown trader'));
        copy.append(
          el(
            'small',
            '',
            (entry.status || 'seen') +
              (entry.lastSeen ? ' · ' + new Date(entry.lastSeen).toLocaleDateString() : '') +
              ' · ' +
              entry.id
          )
        );
        row.append(copy);
        unknownPanel.append(row);
      }
      if (unknownIds.length > 8)
        unknownPanel.append(
          el('small', 'unknown-note', 'and ' + (unknownIds.length - 8) + ' more.')
        );
    }
  }
  if (!history.length)
    list.append(el('p', 'activity-empty', 'No quest changes have been read from the logs yet.'));
  for (const event of history) {
    const q = quests.find(item => item.id === event.id),
      row = el('div', 'activity-row ' + event.status);
    row.append(
      el(
        'span',
        'activity-icon',
        event.status === 'completed' ? '✓' : event.status === 'failed' ? '!' : '↗'
      )
    );
    const body = el('div');
    body.append(
      el('strong', '', q?.name || 'Quest ' + event.id),
      el(
        'small',
        '',
        event.status[0].toUpperCase() +
          event.status.slice(1) +
          ' · ' +
          new Date(event.observedAt).toLocaleString()
      )
    );
    row.append(body);
    list.append(row);
  }
}
/* What 67 recorded raids can honestly say.
 *
 * Deliberately NOT a survival rate: across 132 log folders the only
 * userMatchOver.status values are Free and Transfer, which describe the match
 * slot and not whether you lived, so every raid is filed as outcome unknown.
 * A survival percentage here would be invented, and the panel says so instead
 * of leaving a gap that looks like a bug. */
function raidStatsPanel(p) {
  const raids = (p.raidHistory || []).filter(raid => raid && raid.startedAt);
  const panel = el('div', 'dashboard-panel raid-stats');
  panel.append(el('h3', '', 'Raid stats'));
  if (!raids.length) {
    panel.append(el('p', 'activity-empty', 'Nothing recorded yet.'));
    return panel;
  }
  const week = Date.now() - 7 * 24 * 3600 * 1000;
  const lengths = raids
    .filter(raid => raid.endedAt > raid.startedAt)
    .map(raid => (raid.endedAt - raid.startedAt) / 60000)
    .sort((a, b) => a - b);
  /* median, not mean: one raid left running while the game was alt-tabbed
   drags an average somewhere no raid has ever been */
  const median = lengths.length
    ? lengths.length % 2
      ? lengths[(lengths.length - 1) / 2]
      : (lengths[lengths.length / 2 - 1] + lengths[lengths.length / 2]) / 2
    : 0;
  const recent = raids.filter(raid => raid.startedAt >= week).length;
  const summary = el('p', 'raid-stats-summary');
  summary.append(
    el('span', '', raids.length + ' raids'),
    el('span', '', recent + ' in the last 7 days'),
    el('span', '', lengths.length ? 'median ' + Math.round(median) + ' min' : 'no finished raids')
  );
  panel.append(summary);

  const byMap = new Map();
  for (const raid of raids) {
    const id = raid.map || 'unknown';
    byMap.set(id, (byMap.get(id) || 0) + 1);
  }
  const ranked = [...byMap.entries()].sort((a, b) => b[1] - a[1]);
  const most = ranked[0][1];
  const chart = el('div', 'raid-chart');
  for (const [id, count] of ranked) {
    const row = el('div', 'raid-chart-row');
    const bar = el('span', 'raid-bar');
    bar.style.width = Math.round((count / most) * 100) + '%';
    const track = el('span', 'raid-bar-track');
    track.append(bar);
    row.append(
      el('span', 'raid-chart-label', mapName(id)),
      track,
      el('span', 'raid-chart-count', String(count))
    );
    chart.append(row);
  }
  panel.append(chart);

  const carried = raids.filter(raid => Array.isArray(raid.questIds));
  if (carried.length) {
    const total = carried.reduce((n, raid) => n + raid.questIds.length, 0);
    panel.append(
      el(
        'p',
        'raid-stats-note',
        'You went in with ' +
          (total / carried.length).toFixed(1) +
          ' active quests per raid on average.'
      )
    );
  }
  /* Records written before raids were stamped from the log carry the time the
     application read the line, not the time the raid ran, and a good few of
     them came out shorter than a raid can be. They cannot be repaired, so the
     panel counts them instead of quietly averaging them in. */
  const impossible = raids.filter(
    raid => raid.endedAt > raid.startedAt && raid.endedAt - raid.startedAt < 3 * 60000
  ).length;
  if (impossible)
    panel.append(
      el(
        'p',
        'raid-stats-note quiet',
        impossible +
          ' of these are under three minutes. Those were stamped when the log was read rather than when the raid ran; a raid recorded now is timed from the log itself.'
      )
    );
  panel.append(
    el(
      'p',
      'raid-stats-note quiet',
      'Whether you survived is not in the game logs, so it is not shown. The logs record the match slot, not the outcome.'
    )
  );
  return panel;
}

/* The brief already names what a quest needs and what it unlocks, one step in
 * each direction. That answers "what is next" and not "how far in am I", which
 * is the question with 503 quests and 192 done.
 *
 * This walks the whole chain both ways and groups it by distance, so a quest
 * reads as a position in a line of work rather than a pair of neighbours.
 * Breadth-first with a seen set: the graph has diamonds - two prerequisites
 * that share a grandparent - and a depth-first walk would print those twice
 * and, where a catalog has a cycle, not stop. */
function questChainLayers(quest) {
  const layer = (seeds, step) => {
    const seen = new Set([quest.id]);
    const layers = [];
    let edge = seeds.filter(q => q && !seen.has(q.id));
    while (edge.length && layers.length < 12) {
      for (const q of edge) seen.add(q.id);
      layers.push(edge);
      const next = [];
      for (const q of edge)
        for (const other of step(q))
          if (other && !seen.has(other.id) && !next.includes(other)) next.push(other);
      edge = next;
    }
    return layers;
  };
  const needs = q =>
    (q.requirements || [])
      .map(req => quests.find(x => x.id === requirementId(req)))
      .filter(Boolean);
  return {
    before: layer(needs(quest), needs),
    after: layer(unlockedBy(quest.id), q => unlockedBy(q.id))
  };
}
/* A whole route, rather than one quest and its neighbours. The bands are
 * `chainDepth` from the catalogue - how many quests deep into its own line a
 * quest sits - so the view runs from the openers to the last one, and where
 * you are on it is the colour of the dots.
 *
 * Clicking a quest here opens its own chain, so the two views are a way
 * through each other rather than two dead ends. */
function renderQuestSet(label, ids, note, summary) {
  const content = $('chain-content'),
    members = quests.filter(quest => ids.has(quest.id));
  content.replaceChildren();
  $('chain-title').textContent = label;
  const done = members.filter(quest => status(quest) === 'completed').length;
  /* Most routes are honestly described by how many of them are finished. The
     one built from unfinished work is not - it is 0 of everything by
     construction - so a row may bring its own sentence. */
  const headline = summary || done + ' of ' + members.length + ' complete';
  $('chain-sub').textContent = members.length
    ? headline + (note ? ' · ' + note : '')
    : 'Nothing on this route yet.';

  const byDepth = new Map();
  for (const quest of members) {
    const depth = Number.isFinite(quest.chainDepth) ? quest.chainDepth : 0;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth).push(quest);
  }
  /* Left to right, one column per depth: what opens the line on the left, the
     end of it on the right. Stacked bands read as a list of groups; columns
     read as a progression, which is what a chain is. */
  const track = el('div', 'chain-track');
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  depths.forEach((depth, index) => {
    const entries = byDepth.get(depth).sort((a, b) => a.name.localeCompare(b.name));
    /* Not "2 deep" - that is depth in a graph, which is a fact about the data
       and not a word anyone reading a route wants. A layered diagram numbers
       its columns, and for a line of quests the honest number is which step of
       it you are looking at. The one it ends on says so. */
    const last = index === depths.length - 1;
    track.append(
      chainColumn(
        last && depths.length > 1 ? 'final step' : 'step ' + (index + 1),
        entries,
        last ? 'chain-column-last' : ''
      )
    );
  });
  content.append(track);
}
/* One step of a chain: a heading and the quests that sit at that distance,
 * stacked. Shared by the route view and the single-quest view so both read
 * the same way round. */
function chainColumn(heading, entries, extra = '', current = null) {
  const column = el('div', 'chain-band ' + extra);
  column.append(el('span', 'chain-depth', heading));
  const items = el('div', 'chain-items');
  for (const quest of entries) {
    const here = current && quest.id === current.id;
    const node = el('button', 'chain-node ' + status(quest) + (here ? ' chain-here' : ''));
    node.append(el('span', 'chain-dot'), el('span', 'chain-name', quest.name));
    node.append(el('span', 'chain-trader', quest.traderName));
    node.title = quest.name + ' — ' + quest.traderName + ' · ' + status(quest);
    if (!here)
      node.onclick = () => {
        selectQuest(quest);
        renderChain(quest);
      };
    items.append(node);
  }
  column.append(items);
  return column;
}
function renderChain(quest) {
  const { before, after } = questChainLayers(quest),
    content = $('chain-content');
  content.replaceChildren();
  $('chain-title').textContent = quest.name;
  const behind = before.reduce((n, layer) => n + layer.length, 0),
    ahead = after.reduce((n, layer) => n + layer.length, 0);
  $('chain-sub').textContent =
    behind + ahead
      ? behind + ' before it, ' + ahead + ' after it'
      : 'This quest stands on its own.';

  /* Left to right, like the route view: the furthest prerequisite on the left,
     this quest in the middle, what it unlocks running off to the right. The
     `before` layers come back nearest-first, so they are reversed. */
  const track = el('div', 'chain-track');
  [...before].reverse().forEach((entries, index) => {
    const steps = before.length - index;
    track.append(chainColumn(steps === 1 ? 'needs' : steps + ' before', entries));
  });
  track.append(chainColumn('this quest', [quest], 'chain-current', quest));
  after.forEach((entries, index) => {
    track.append(
      chainColumn(
        index === 0 ? 'unlocks' : index + 1 + ' on',
        entries,
        index === after.length - 1 ? 'chain-column-last' : ''
      )
    );
  });
  content.append(track);
}

function renderDashboard() {
  const p = profile(),
    content = $('dashboard-content'),
    done = quests.filter(q => status(q) === 'completed').length,
    active = quests.filter(q => status(q) === 'active').length,
    failed = quests.filter(q => status(q) === 'failed').length,
    objectiveTotal = quests.reduce((n, q) => n + q.objectives.length, 0),
    objectiveDone = quests.reduce((n, q) => n + q.objectives.filter(isDone).length, 0);
  content.replaceChildren();
  $('dashboard-title').textContent =
    data.mode === 'seasonal' ? 'Kord Breach overview' : data.mode.toUpperCase() + ' overview';
  $('dashboard-sub').textContent = done + ' of ' + quests.length + ' quests completed';
  const stats = el('div', 'dashboard-stats');
  for (const [value, label] of [
    [done, 'Completed quests'],
    [active, 'Active quests'],
    [objectiveDone + ' / ' + objectiveTotal, 'Objectives'],
    [(p.raidHistory || []).length, 'Raids recorded']
  ]) {
    const card = el('div', 'stat-card');
    card.append(el('strong', '', String(value)), el('small', '', label));
    stats.append(card);
  }
  content.append(stats);
  renderNextSteps(content);
  const kappa = collectorPath(),
    lightkeeper = lightkeeperPath();
  const routeRow = (set, color) => [
    quests.filter(q => set.has(q.id) && status(q) === 'completed').length,
    set.size,
    color
  ];
  const progress = el('div', 'dashboard-panel');
  progress.append(el('h3', '', 'Progress'));
  if (kappa.size || lightkeeper.size)
    progress.append(
      el(
        'p',
        'panel-note',
        'Route totals follow the Kappa and Lightkeeper flags in the bundled tarkov.dev catalog (' +
          allData.generatedAt.slice(0, 10) +
          ').'
      )
    );
  /* One neutral for all five. Each bar already carries its own label and its
     own numbers, so five different colours added nothing to read and cost the
     greyscale rule the rest of the interface keeps. */
  const barFill = '#9aa0a6';
  /* Every bar measures a set of quests, so every bar can open it. The note
     says what the set is, because "Objectives" counting quests with work left
     is not obvious from a bar. */
  const everyQuest = new Set(quests.map(quest => quest.id));
  const unfinished = new Set(
    quests
      .filter(quest => quest.objectives.some(objective => !isDone(objective)))
      .map(quest => quest.id)
  );
  const tracked = new Set(
    quests.filter(quest => status(quest) !== 'untracked').map(quest => quest.id)
  );
  for (const [label, value, total, color, ids, note, summary, route] of [
    ['Quests', done, quests.length, barFill, everyQuest, 'every quest in the catalogue'],
    [
      'Objectives',
      objectiveDone,
      objectiveTotal,
      barFill,
      unfinished,
      'the quests with objectives still open',
      objectiveTotal - objectiveDone + ' objectives left across ' + unfinished.size + ' quests'
    ],
    [
      'Tracked quests',
      active + done + failed,
      quests.length,
      barFill,
      tracked,
      'anything you have started, finished or failed'
    ],
    [
      'Kappa route',
      ...routeRow(kappa, barFill),
      kappa,
      'flagged for Kappa in the bundled catalogue',
      undefined,
      true
    ],
    [
      'Lightkeeper route',
      ...routeRow(lightkeeper, barFill),
      lightkeeper,
      'flagged for Lightkeeper in the bundled catalogue',
      undefined,
      true
    ]
  ].filter(row => row[2] > 0)) {
    /* A depth tree only says something about a route, and three of these five
       bars do not measure one - most quests have no prerequisite at all, so
       the tree came out as a single column holding 59%, 41% and 86% of the
       set, eleven thousand pixels of list pretending to be a shape.

       Those three are a reading, so they look like one: a plain row, nothing
       to press. Only the two real routes are buttons. A control that looks
       pressable and is not is a worse answer than a number that never claimed
       to be one. */
    const row = el(route ? 'button' : 'div', 'dashboard-progress');
    if (route) {
      row.title = 'Open ' + label.toLowerCase() + ' as a tree';
      row.onclick = () => {
        renderQuestSet(label, ids, note, summary);
        $('dashboard-dialog').close();
        $('chain-dialog').showModal();
      };
    }
    row.append(el('span', '', label), el('small', '', value + ' / ' + total));
    const track = el('div', 'mini-track'),
      fill = el('i');
    fill.style.width = (total ? (value / total) * 100 : 0) + '%';
    fill.style.background = color;
    track.append(fill);
    row.append(track);
    progress.append(row);
  }
  content.append(progress);
  const byTrader = el('div', 'dashboard-panel');
  byTrader.append(el('h3', '', 'Trader progress'));
  const traders = [...new Set(quests.map(q => q.traderName))].sort();
  for (const trader of traders) {
    const list = quests.filter(q => q.traderName === trader),
      complete = list.filter(q => status(q) === 'completed').length,
      row = el('button', 'dashboard-link');
    row.append(el('span', '', trader), el('small', '', complete + ' / ' + list.length));
    row.onclick = () => {
      $('dashboard-dialog').close();
      $('trader').value = trader;
      renderList();
    };
    byTrader.append(row);
  }
  content.append(byTrader);
  content.append(raidStatsPanel(p));
  const history = el('div', 'dashboard-panel raid-history');
  history.append(el('h3', '', 'Recent raids'));
  if (!(p.raidHistory || []).length)
    history.append(
      el(
        'p',
        'activity-empty',
        'A raid will appear here when the local log observer sees it start.'
      )
    );
  for (const raid of (p.raidHistory || []).slice(0, 12)) {
    const row = el('div', 'history-row'),
      elapsed =
        raid.endedAt && raid.startedAt
          ? Math.max(1, Math.round((raid.endedAt - raid.startedAt) / 60000)) + ' min'
          : raid.status === 'started'
            ? 'In progress'
            : 'Finished';
    row.append(
      el('strong', '', mapName(raid.map || 'unknown')),
      el('span', '', raid.role?.toUpperCase() || 'PMC'),
      el('small', '', new Date(raid.startedAt).toLocaleString() + ' · ' + elapsed)
    );
    history.append(row);
  }
  content.append(history);
}
function readyToStart() {
  const done = id => profile().quests[id] === 'completed';
  return quests
    .filter(q => {
      if (status(q) !== 'untracked') return false;
      return (q.requirements || []).every(req => {
        const id = requirementId(req);
        return !id || done(id);
      });
    })
    .sort((a, b) => (a.chainDepth ?? 99) - (b.chainDepth ?? 99) || a.name.localeCompare(b.name));
}
function mapWorkload() {
  const rows = new Map();
  for (const q of quests.filter(q => status(q) === 'active'))
    for (const id of q.mapIds?.length ? q.mapIds : []) {
      const row = rows.get(id) || { id, quests: 0, objectives: 0 };
      row.quests++;
      row.objectives += q.objectives.filter(
        o => !isDone(o) && (!o.mapIds?.length || o.mapIds.includes(id))
      ).length;
      rows.set(id, row);
    }
  return [...rows.values()]
    .filter(row => mapDefinitions.some(map => map.id === row.id))
    .sort((a, b) => b.quests - a.quests || a.id.localeCompare(b.id));
}
function dashboardPanel(title, note) {
  const panel = el('div', 'dashboard-panel');
  panel.append(el('h3', '', title));
  if (note) panel.append(el('p', 'panel-note', note));
  return panel;
}
function renderNextSteps(content) {
  const ready = readyToStart(),
    workload = mapWorkload();
  if (workload.length) {
    const panel = dashboardPanel(
      'Where to go next',
      'Active quests and the objectives still open on each map.'
    );
    for (const row of workload) {
      const link = el('button', 'dashboard-link');
      link.append(
        el('span', '', mapName(row.id)),
        el(
          'small',
          '',
          row.quests +
            ' quest' +
            (row.quests === 1 ? '' : 's') +
            ' · ' +
            row.objectives +
            ' objective' +
            (row.objectives === 1 ? '' : 's')
        )
      );
      link.onclick = async () => {
        $('dashboard-dialog').close();
        await switchMap(row.id, { filterQuests: true });
        showActiveQuests();
      };
      panel.append(link);
    }
    content.append(panel);
  }
  const panel = dashboardPanel(
    'Ready to start',
    ready.length +
      ' quest' +
      (ready.length === 1 ? '' : 's') +
      ' have every prerequisite completed and are not tracked yet.'
  );
  if (!ready.length)
    panel.append(
      el('p', 'activity-empty', 'Nothing is waiting. Mark a quest Active or refresh the game logs.')
    );
  for (const q of ready.slice(0, 8)) {
    const link = el('button', 'dashboard-link');
    link.append(el('span', '', q.name), el('small', '', q.traderName + ' · ' + questMaps(q)));
    link.onclick = () => {
      $('dashboard-dialog').close();
      selectQuest(q);
    };
    panel.append(link);
  }
  content.append(panel);
}
function openDashboard() {
  renderDashboard();
  $('dashboard-dialog').showModal();
}
function price(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat('en-US').format(value) + ' ₽' : '—';
}
function itemModeName() {
  return data.mode === 'seasonal' ? 'Seasonal · Kord Breach' : data.mode.toUpperCase();
}
function itemCatalogStatus() {
  if (!itemCatalog) return;
  $('items-profile').textContent = itemModeName() + ' prices';
  const date = itemCatalog.pricesUpdatedAt || itemCatalog.generatedAt,
    when = date ? new Date(date).toLocaleString() : 'unknown time';
  $('item-catalog-status').textContent =
    new Intl.NumberFormat('en-US').format(itemCatalog.items.length) +
    ' items · prices checked ' +
    when +
    ' · ' +
    itemCatalog.source;
}
function updateItemHotkey(state) {
  itemHotkeyState = { ...itemHotkeyState, ...state };
  data.settings.itemHotkeyEnabled = itemHotkeyState.enabled;
  const checkbox = $('item-hotkey-enabled'),
    row = checkbox.closest('.item-hotkey');
  checkbox.checked = itemHotkeyState.enabled;
  row.classList.toggle('disabled', !itemHotkeyState.enabled || !itemHotkeyState.registered);
  $('item-hotkey-status').textContent = !itemHotkeyState.enabled
    ? 'Shortcut off'
    : itemHotkeyState.registered
      ? 'Ready · hover an inventory item, then press Shift+F8'
      : 'Shift+F8 is already used by another app';
}
function renderItemResults(items, { scanned = false } = {}) {
  lastItemResults = items;
  lastItemResultsScanned = scanned;
  const root = $('item-results');
  root.replaceChildren();
  if (!items.length) {
    const empty = el('div', 'item-empty');
    empty.append(
      uiIcon('search'),
      el('strong', '', scanned ? 'No reliable item match' : 'No matching items'),
      el(
        'p',
        '',
        scanned
          ? 'Keep the cursor on the inventory tile and try Shift+F8 again.'
          : 'Try the full item name or its in-game short name.'
      )
    );
    root.append(empty);
    return;
  }
  for (const item of items) {
    const noFlea = item.types?.includes('noFlea'),
      flea =
        !noFlea && item.avg24hPrice > 0
          ? item.avg24hPrice
          : !noFlea && item.lastLowPrice > 0
            ? item.lastLowPrice
            : null,
      trader = item.bestTrader?.price > 0 ? item.bestTrader.price : null,
      best = Math.max(flea || 0, trader || 0),
      slots = Math.max(1, (item.width || 1) * (item.height || 1)),
      perSlot = best ? Math.round(best / slots) : 0,
      threshold = Number(data.settings.itemValueThreshold) || 0,
      grade =
        threshold && perSlot >= threshold
          ? 'great'
          : threshold && perSlot >= threshold * 0.6
            ? 'good'
            : '',
      card = el('article', 'item-card' + (grade ? ' loot-' + grade : '')),
      head = el('div', 'item-card-head'),
      glyph = el('span', 'item-glyph', (item.shortName || item.name).slice(0, 3).toUpperCase()),
      title = el('div', 'item-title');
    title.append(
      el('strong', '', item.name),
      el(
        'small',
        '',
        (item.shortName || '') +
          ' · ' +
          slots +
          ' slot' +
          (slots === 1 ? '' : 's') +
          (item.category ? ' · ' + item.category : '')
      )
    );
    head.append(glyph, title);
    if (scanned)
      head.append(el('span', 'match-badge', Math.round((item.confidence || 0) * 100) + '% match'));
    if (grade === 'great') head.append(el('span', 'loot-badge', 'TAKE'));
    card.append(head);
    const values = el('div', 'item-values'),
      fleaBox = el('div', 'price-box');
    fleaBox.append(
      el('span', '', 'FLEA 24H'),
      el('strong', '', price(flea)),
      el(
        'small',
        '',
        noFlea
          ? 'Not flea marketable'
          : item.low24hPrice > 0
            ? 'Low ' + price(item.low24hPrice)
            : 'No recent low'
      )
    );
    const traderBox = el('div', 'price-box');
    traderBox.append(
      el('span', '', 'BEST TRADER'),
      el('strong', '', price(trader)),
      el('small', '', item.bestTrader?.trader || 'No trader price')
    );
    const slotBox = el('div', 'price-box best-value');
    slotBox.append(
      el('span', '', 'BEST / SLOT'),
      el('strong', '', price(perSlot || null)),
      el(
        'small',
        '',
        best
          ? flea !== null && flea >= trader
            ? 'Sell on flea'
            : 'Sell to ' + item.bestTrader.trader
          : 'No market price'
      )
    );
    values.append(fleaBox, traderBox, slotBox);
    card.append(values);
    const foot = el('div', 'item-card-foot'),
      change = Number.isFinite(item.changeLast48hPercent) ? item.changeLast48hPercent : null;
    foot.append(
      el(
        'span',
        change > 0 ? 'price-up' : change < 0 ? 'price-down' : '',
        change === null
          ? '48h change unavailable'
          : (change > 0 ? '+' : '') + change.toFixed(1) + '% in 48h'
      ),
      el(
        'span',
        '',
        item.minLevelForFlea ? 'Flea level ' + item.minLevelForFlea : 'Flea restriction unknown'
      )
    );
    card.append(foot);
    root.append(card);
  }
}
function searchItems() {
  if (!itemCatalog) return;
  const query = $('item-search')
    .value.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!query) {
    const root = $('item-results'),
      empty = el('div', 'item-empty');
    empty.append(
      uiIcon('crosshair'),
      el('strong', '', 'Hover an inventory item and press Shift+F8'),
      el(
        'p',
        '',
        'No Inspect needed. Keep the cursor on its tile while TarkovEyes reads the label around it.'
      )
    );
    root.replaceChildren(empty);
    return;
  }
  const words = query.split(' '),
    ranked = itemCatalog.items
      .map(item => {
        const name = (item.name + ' ' + item.shortName).toLowerCase(),
          score =
            (name.startsWith(query) ? 5 : 0) +
            (name.includes(query) ? 3 : 0) +
            words.filter(word => name.includes(word)).length / words.length;
        return { item, score };
      })
      .filter(row => row.score >= 1)
      .sort((a, b) => b.score - a.score || (b.item.avg24hPrice || 0) - (a.item.avg24hPrice || 0))
      .slice(0, 30)
      .map(row => row.item);
  renderItemResults(ranked);
}
async function loadItemsView() {
  $('items-profile').textContent = itemModeName() + ' prices';
  $('item-value-threshold').value = data.settings.itemValueThreshold;
  $('item-catalog-status').textContent = 'Loading local price catalog…';
  try {
    itemCatalog = bridge.loadItems
      ? await bridge.loadItems(data.mode)
      : await (await fetch('data/items-' + data.mode + '.json')).json();
    itemCatalogStatus();
    searchItems();
  } catch (e) {
    itemCatalog = null;
    $('item-catalog-status').textContent = 'Could not load the local price catalog.';
    renderItemResults([]);
  }
}
async function openItems() {
  if (!$('items-dialog').open) $('items-dialog').showModal();
  await loadItemsView();
}
async function runItemScan() {
  if (!window.companion) {
    toast('Item screenshot scanning is available in the Windows app.');
    return;
  }
  const button = $('scan-item'),
    label = button.querySelector('span');
  button.disabled = true;
  label.textContent = 'Reading…';
  itemScanRunning = true;
  $('item-ocr-preview').textContent = 'Reading the screenshot locally…';
  try {
    const result = await bridge.scanItem(data.mode);
    if (!result) return;
    $('item-ocr-preview').textContent = result.textPreview || 'No text recognized.';
    renderItemResults(result.matches || [], { scanned: true });
    if (result.catalog) itemCatalogStatus();
    toast(
      (result.matches || []).length
        ? 'Item matches ready. Compare before selling.'
        : 'No reliable item name found.'
    );
  } catch (e) {
    renderItemResults([], { scanned: true });
    toast(
      'Item scan failed: ' + e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    );
  } finally {
    itemScanRunning = false;
    button.disabled = false;
    label.textContent = 'Scan screenshot';
  }
}
async function refreshItemPrices() {
  if (!window.companion) {
    toast('Price updates are available in the Windows app.');
    return;
  }
  const button = $('refresh-prices'),
    label = button.querySelector('span');
  button.disabled = true;
  label.textContent = 'Updating…';
  $('item-catalog-status').textContent =
    'Downloading the latest ' + itemModeName() + ' prices from tarkov.dev…';
  try {
    itemCatalog = await bridge.refreshItemPrices(data.mode);
    itemCatalogStatus();
    searchItems();
    toast('Item prices updated.');
  } catch (e) {
    itemCatalogStatus();
    toast(
      'Could not update prices: ' +
        e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    );
  } finally {
    button.disabled = false;
    label.textContent = 'Update prices';
  }
}
function renderScanResults(result) {
  ocrSelection = [];
  $('scan-results').replaceChildren();
  $('ocr-preview').textContent = result.textPreview || '';
  const matches = result.matches || [];
  $('scan-summary').textContent = matches.length
    ? matches.length +
      ' possible quest match' +
      (matches.length === 1 ? '' : 'es') +
      ' · review before applying.'
    : 'No reliable quest names were found. Try a clearer Tasks screenshot.';
  for (const match of matches) {
    const card = el('div', 'scan-card');
    card.append(
      el('strong', '', match.questName),
      el('small', '', Math.round(match.confidence * 100) + '% quest-name match')
    );
    if (!match.objectives.length)
      card.append(
        el('p', 'activity-empty', 'Quest recognized, but no objective progress was readable.')
      );
    for (const objective of match.objectives) {
      const id = match.questId + ':' + objective.id,
        label = el('label', 'scan-objective'),
        check = el('input');
      check.type = 'checkbox';
      check.checked = objective.value > 0 || objective.confirmed;
      check.dataset.scanId = id;
      const body = el('span');
      body.append(
        el('span', '', objective.description),
        el(
          'small',
          '',
          objective.value +
            ' / ' +
            objective.target +
            ' · ' +
            Math.round(objective.confidence * 100) +
            '% text match' +
            (objective.confirmed ? ' · complete' : '')
        )
      );
      label.append(check, body);
      card.append(label);
      ocrSelection.push({
        ...objective,
        questId: match.questId,
        selected: check.checked,
        element: check
      });
    }
    $('scan-results').append(card);
  }
  $('apply-scan').disabled = !ocrSelection.length;
}
async function runTaskScan() {
  if (!window.companion) {
    toast('Task scanning is available in the Windows app.');
    return;
  }
  const button = $('scan-tasks'),
    label = button.querySelector('span');
  button.disabled = true;
  label.textContent = 'Reading…';
  $('scan-summary').textContent = 'Reading the image locally…';
  $('scan-results').replaceChildren();
  $('ocr-preview').textContent = '';
  $('scan-dialog').showModal();
  try {
    const result = await bridge.scanTasks(data.mode);
    if (result) renderScanResults(result);
    else $('scan-dialog').close();
  } catch (e) {
    $('scan-summary').textContent = 'Could not read that screenshot.';
    toast(
      'Task scan failed: ' + e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    );
  } finally {
    button.disabled = false;
    label.textContent = 'Tasks';
  }
}
function openActivity() {
  activityUnread = 0;
  updateActivityBadge();
  renderActivity();
  $('activity-dialog').showModal();
}
function questEventMessage(q, statusValue) {
  const label = q?.name || 'Quest';
  if (statusValue === 'completed') return 'Quest completed: ' + label;
  if (statusValue === 'failed') return 'Quest failed: ' + label;
  return 'New active quest: ' + label;
}
function renderLogDiagnostics() {
  const root = $('log-diagnostics');
  if (!root) return;
  root.replaceChildren();
  const mode =
      observer.mode === 'seasonal' ? 'Seasonal' : observer.mode?.toUpperCase() || 'Unknown',
    map = observer.map ? mapName(observer.map) : 'Waiting',
    session = observer.logSession || 'No session',
    event = observer.lastQuestEventAt
      ? new Date(observer.lastQuestEventAt).toLocaleTimeString()
      : 'None yet';
  for (const [label, value, ok] of [
    [
      'LOG STATUS',
      observer.logsConnected ? 'Connected' : data.settings.logs ? 'Unavailable' : 'Not configured',
      observer.logsConnected
    ],
    ['PROFILE', mode, !!observer.mode],
    ['MAP', map, !!observer.map],
    ['LAST QUEST EVENT', event, !!observer.lastQuestEventAt],
    ['SESSION', session, !!observer.logSession],
    ['FILES', String(observer.logFileCount || 0), observer.logFileCount > 0]
  ]) {
    const card = el('div', 'log-diagnostic' + (ok ? ' ok' : ''));
    card.append(el('span', '', label), el('strong', '', value));
    root.append(card);
  }
}
function connection() {
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
function revealLooseSearch(position, id, category, label) {
  const control = looseLayers.find(([key]) => key === category)?.[1];
  if (control) $(control).checked = true;
  renderLoot();
  saveLayers();
  focusMapPosition(position, label);
  showLoot({ kind: 'loose', position, items: [id], category });
}
function revealContainerSearch(position, type, category, label) {
  const control = containerLayers.find(([key]) => key === category)?.[1];
  if (control) $(control).checked = true;
  renderLoot();
  saveLayers();
  focusMapPosition(position, label);
  showLoot({ kind: 'container', position, type, category });
}
function revealMapSearch(position, label, layer) {
  $(layer).checked = true;
  renderAllMapLayers();
  saveLayers();
  focusMapPosition(position, label);
}
function commandEntries(query = '') {
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
function updateCommandSelection() {
  const buttons = [...$('command-results').querySelectorAll('.command-result')];
  buttons.forEach((button, index) => {
    const active = index === commandIndex;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-selected', String(active));
  });
  buttons[commandIndex]?.scrollIntoView({ block: 'nearest' });
}
function runCommand(index = commandIndex) {
  const entry = commandMatches[index];
  if (!entry) return;
  $('command-dialog').close();
  Promise.resolve(entry.run()).catch(error =>
    toast('Could not open that result: ' + error.message, 'error')
  );
}
function renderCommandResults(reset = false) {
  const root = $('command-results');
  commandMatches = commandEntries($('command-search').value).slice(0, 12);
  if (reset) commandIndex = 0;
  else commandIndex = Math.min(commandIndex, Math.max(0, commandMatches.length - 1));
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
      commandIndex = index;
      updateCommandSelection();
    };
    button.onclick = () => runCommand(index);
    root.append(button);
  });
  updateCommandSelection();
}
function openCommandPalette(seed = '') {
  const dialog = $('command-dialog'),
    input = $('command-search');
  if (!dialog.open) dialog.showModal();
  input.value = seed;
  renderCommandResults(true);
  requestAnimationFrame(() => input.focus());
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
    view = {
      x: p.x - (p.x - view.x) * ratio,
      y: p.y - (p.y - view.y) * ratio,
      w: next,
      h: view.h * ratio
    };
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
    new ResizeObserver(() => {
      mapSvgBox = null;
    }).observe($('map-svg'));
  railLayout.addEventListener('change', scheduleBriefAlign);
  $('quest-list').addEventListener('scroll', scheduleBriefAlign, { passive: true });
}
function localAssetPath(asset) {
  return 'assets' + asset.path;
}
// Waits for the bitmap itself, not for a decoded frame. image.decode() never
// settles while the window is hidden or fully occluded, which left an
// image-based map (Icebreaker, The Labyrinth) stuck on "Loading ..." whenever
// the map changed with Raid Notes in the background - exactly what happens when
// a raid starts while the user is in the game. onload fires either way.
function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(Error('Missing map artwork: ' + path));
    image.src = path;
  });
}
async function loadMapArtwork(definition) {
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
    W = parts[2];
    H = parts[3];
    artwork.replaceChildren(
      ...[...doc.documentElement.childNodes].map(node => document.importNode(node, true))
    );
  } else {
    const image = await loadImage(path);
    W = image.naturalWidth;
    H = image.naturalHeight;
    artwork.replaceChildren(
      svg('image', { href: path, x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none' })
    );
  }
  $('map-svg').setAttribute('viewBox', `0 0 ${W} ${H}`);
}
function configureFloors() {
  const control = $('floor'),
    base = { id: baseFloor(), name: mapDefinition.baseFloor?.name || 'Main' };
  const entries =
    mapDefinition.baseAsset.type === 'image' && mapDefinition.floors.some(item => item.asset)
      ? mapDefinition.floors.filter(item => item.asset)
      : [base, ...mapDefinition.floors.filter(item => item.svgLayer && item.id !== base.id)];
  control.replaceChildren(...entries.map(item => new Option(item.name, item.id)));
  control.disabled = entries.length < 2;
}
async function switchMap(id, { filterQuests = false } = {}) {
  const definition = mapDefinitions.find(map => map.id === id);
  if (!definition) return;
  if (markerAdding) setMarkerPlacement(false);
  const token = ++mapLoadToken,
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
  mapDefinition = definition;
  currentMapId = id;
  allPois = poiDoc.pois;
  pois = allPois.filter(p => p.kind === 'extract' || p.kind === 'transit');
  lootData = lootDoc;
  confirmedFix = null;
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
  floor = baseFloor();
  view = { x: 0, y: 0, w: W, h: H };
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
async function adoptObservedSession(mode, map) {
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
async function loadMode() {
  const oldId = selected?.id;
  allData = bridge.loadCatalog
    ? await bridge.loadCatalog(data.mode)
    : await (await fetch(data.mode === 'pve' ? 'data/quests-pve.json' : 'data/quests.json')).json();
  const extras = (specialTracks?.quests || []).filter(
    q => !q.profiles || q.profiles.includes(data.mode)
  );
  quests = [...allData.quests, ...extras].sort((a, b) => a.name.localeCompare(b.name));
  indexObjectiveOwners();
  if (mapDefinition)
    $('location-sub').textContent =
      quests.filter(q => q.mapIds.includes(currentMapId)).length + ' quests on this map';
  $('trader').replaceChildren(
    new Option('All traders', ''),
    ...[...new Set(quests.map(q => q.traderName))].sort().map(t => new Option(t, t))
  );
  updateQuestPathOptions();
  selected = oldId ? quests.find(q => q.id === oldId) || null : null;
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
async function start() {
  if (!bridge) {
    // Static browser preview is isolated from the desktop progress store.
    let cached;
    try {
      cached = JSON.parse(localStorage.getItem('raid-notes-preview'));
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
    const save = () => localStorage.setItem('raid-notes-preview', JSON.stringify(d));
    bridge = {
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
    };
  }
  const boot = await bridge.bootstrap();
  data = boot.data;
  observer = boot.observer;
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
    ...hazardKinds.map(kind => [kind.control, kind.key])
  ])
    $(id).checked = !!data.settings.mapLayers[key];
  loadHideDone();
  updateLayerChildren();
  [
    mapDefinitions,
    questImages,
    bossSpawnRates,
    bossCatalog,
    traderCatalog,
    keyCatalog,
    labKeycards,
    specialTracks,
    questWiki
  ] = await Promise.all([
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
  $('marker-form').onsubmit = saveMarkerEditor;
  $('close-marker').onclick = $('cancel-marker').onclick = closeMarkerEditor;
  $('marker-dialog').addEventListener('cancel', event => {
    event.preventDefault();
    closeMarkerEditor();
  });
  $('quick-find').onclick = () => openCommandPalette();
  $('command-search').oninput = () => renderCommandResults(true);
  $('command-search').onkeydown = event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      commandIndex = Math.min(commandMatches.length - 1, commandIndex + 1);
      updateCommandSelection();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      commandIndex = Math.max(0, commandIndex - 1);
      updateCommandSelection();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runCommand();
    }
  };
  $('toggle-details').onclick = () => setDetailsCollapsed(!detailsCollapsed);
  $('focus-map').onclick = () => setMapFocus(!mapFocus);
  document
    .querySelectorAll('[data-layer-preset]')
    .forEach(button => (button.onclick = () => applyLayerPreset(button.dataset.layerPreset)));
  /* Typing fires once per character and rebuilding the list is the expensive
     part - 21ms with every quest shown - so the search waits for a pause while
     the four selects, which change once per use, still redraw immediately. */
  $('quest-search').addEventListener('input', scheduleListRender);
  for (const id of ['map-filter', 'trader', 'status-filter'])
    $(id).addEventListener('change', renderList);
  $('path-filter').addEventListener('change', applyQuestPathFilter);
  for (const id of ['layer-extract', 'layer-scav'])
    $(id).onchange = () => {
      updateLayerChildren();
      renderMarkers();
      renderExtractLabels();
      saveLayers();
    };
  $('layer-transit').onchange = () => {
    updateLayerChildren();
    renderMarkers();
    renderExtractLabels();
    saveLayers();
  };
  for (const kind of hazardKinds)
    $(kind.control).onchange = () => {
      renderHazards();
      saveLayers();
    };
  for (const [, id] of [...containerLayers, ...looseLayers])
    $(id).onchange = () => {
      if ($(id).checked && !((lootData?.containers?.length || 0) + (lootData?.loose?.length || 0)))
        toast('No verified loot positions are available for ' + mapName(currentMapId) + ' yet.');
      renderLoot();
      saveLayers();
    };
  $('loot-hide-all').onclick = () => {
    window.battlepassLayer?.clear();
    for (const [, id] of [...containerLayers, ...looseLayers]) $(id).checked = false;
    renderLoot();
    saveLayers();
  };
  $('loot-valuables-only').onclick = () => {
    window.battlepassLayer?.enableAll();
    for (const [, id] of [...containerLayers, ...looseLayers])
      $(id).checked = [
        'layer-container-valuables',
        'layer-loose-valuables',
        'layer-loose-battlepass'
      ].includes(id);
    renderLoot();
    saveLayers();
  };
  $('loot-essentials').onclick = () => {
    window.battlepassLayer?.enableAll();
    const essentials = new Set([
      'layer-container-medical',
      'layer-container-rations',
      'layer-loose-medical',
      'layer-loose-provisions',
      'layer-loose-keys',
      'layer-loose-task',
      'layer-loose-battlepass'
    ]);
    for (const [, id] of [...containerLayers, ...looseLayers])
      $(id).checked = essentials.has(id) && !$(id).disabled;
    renderLoot();
    saveLayers();
  };
  $('layer-lab-keycards').onchange = () => {
    updateLayerChildren();
    renderKeycardDoors();
    renderDoors();
    renderSwitches();
    renderBosses();
    saveLayers();
  };
  $('layer-lab-keycard-labels').onchange = () => {
    renderKeycardDoors();
    renderDoors();
    renderSwitches();
    renderBosses();
    saveLayers();
  };
  $('layer-bosses').onchange = () => {
    renderBosses();
    saveLayers();
  };
  $('layer-switches').onchange = () => {
    renderSwitches();
    renderBosses();
    saveLayers();
  };
  $('layer-doors').onchange = () => {
    renderDoors();
    renderSwitches();
    renderBosses();
    saveLayers();
  };
  $('layer-labels').onchange = () => {
    renderLandmarks();
    saveLayers();
  };
  const hideDone = $('layer-hide-done');
  if (hideDone) hideDone.onchange = () => setHideDone(hideDone.checked);
  $('layer-custom').onchange = () => {
    renderCustomMarkers();
    saveLayers();
  };
  for (const id of [
    'layer-pmc-extract-labels',
    'layer-scav-extract-labels',
    'layer-transit-labels'
  ])
    $(id).onchange = () => {
      renderExtractLabels();
      saveLayers();
    };
  $('floor').onchange = () => applyFloor($('floor').value);
  $('location').onchange = async () => {
    const previous = currentMapId;
    try {
      await switchMap($('location').value, { filterQuests: true });
    } catch {
      $('location').value = previous;
      toast('Could not load that bundled map.', 'error');
    }
  };
  $('show-active').onclick = showActiveQuests;
  $('start-example').onclick = () => {
    const q =
      quests.find(q => q.mapIds.includes(currentMapId) && objectivePoints(q).length) ||
      quests.find(q => q.mapIds.includes(currentMapId)) ||
      quests[0];
    selectQuest(q);
    focusQuest(q);
  };
  $('profile').onchange = async () => {
    const next = $('profile').value;
    try {
      await bridge.mode(next);
      data.mode = next;
      await loadMode();
      if ($('activity-dialog').open) renderActivity();
      if ($('items-dialog').open) await loadItemsView();
      toast('Switched to ' + modeLabel(next) + ' progress.');
    } catch {
      toast('Could not switch profiles.', 'error');
    }
  };
  $('setup-tab').onclick = connection;
  $('connect-shortcut').onclick = connection;
  $('map-tab').onclick = () => {
    if ($('connection-dialog').open) $('connection-dialog').close();
  };
  document
    .querySelectorAll('.close-dialog')
    .forEach(b => (b.onclick = () => $('connection-dialog').close()));
  $('activity-button').onclick = openActivity;
  $('close-activity').onclick = () => $('activity-dialog').close();
  $('close-chain').onclick = () => $('chain-dialog').close();
  $('items-button').onclick = openItems;
  $('close-items').onclick = () => $('items-dialog').close();
  $('scan-item')?.addEventListener('click', runItemScan);
  $('refresh-prices').onclick = refreshItemPrices;
  $('item-search').oninput = searchItems;
  $('item-hotkey-enabled').onchange = async () => {
    const enabled = $('item-hotkey-enabled').checked;
    try {
      updateItemHotkey(await bridge.itemHotkey(enabled));
      toast(
        enabled
          ? itemHotkeyState.registered
            ? 'Inventory scan enabled · press Shift+F8 over an item.'
            : 'Shift+F8 is unavailable.'
          : 'Inventory scan disabled.'
      );
    } catch {
      $('item-hotkey-enabled').checked = !enabled;
      toast('Could not change the inventory shortcut.', 'error');
    }
  };
  $('item-value-threshold').onchange = async () => {
    const input = $('item-value-threshold'),
      previous = data.settings.itemValueThreshold,
      value = Math.max(0, Math.min(1000000, Number(input.value) || 0));
    input.value = value;
    try {
      data.settings.itemValueThreshold = await bridge.itemValueThreshold(value);
      renderItemResults(lastItemResults, { scanned: lastItemResultsScanned });
      toast(
        value
          ? 'High-value loot starts at ' + price(value) + ' per slot.'
          : 'Loot highlighting is off.'
      );
    } catch {
      data.settings.itemValueThreshold = previous;
      input.value = previous;
      toast('Could not save the loot threshold.', 'error');
    }
  };
  $('dashboard-button').onclick = openDashboard;
  $('close-dashboard').onclick = () => $('dashboard-dialog').close();
  $('scan-tasks').onclick = runTaskScan;
  $('rescan-tasks').onclick = runTaskScan;
  $('close-scan').onclick = () => $('scan-dialog').close();
  $('apply-scan').onclick = async () => {
    const chosen = ocrSelection.filter(item => item.element.checked);
    if (!chosen.length) {
      toast('Select at least one recognized objective.');
      return;
    }
    const button = $('apply-scan');
    button.disabled = true;
    try {
      for (const item of chosen)
        await changeProgress({
          type: 'objective-counter',
          id: item.id,
          value: item.value,
          target: item.target,
          confirmed: item.confirmed,
          source: 'ocr'
        });
      /* The Tasks screen only lists tasks you are on, so a quest this scan
         just recorded progress for is one you have taken - and leaving it
         `untracked` kept it off the map anyway, which is most of the reason
         the map looked empty for quests the game says are half done. Only
         untracked is promoted: a completed or failed record is a stronger
         statement than a reading of a screenshot and is left alone. */
      const started = [];
      for (const id of new Set(chosen.map(item => item.questId))) {
        const q = quests.find(item => item.id === id);
        if (!q || status(q) !== 'untracked') continue;
        await changeProgress({ type: 'quest', id, value: 'active' });
        started.push(q.name);
      }
      $('scan-dialog').close();
      if (selected) renderDetail();
      renderList();
      renderMarkers();
      toast(
        chosen.length +
          ' objective update' +
          (chosen.length === 1 ? '' : 's') +
          ' applied. Completed steps are confirmed; partial counts remain reviewable.' +
          (started.length
            ? ' ' +
              started.length +
              ' quest' +
              (started.length === 1 ? ' is' : 's are') +
              ' now on the map.'
            : '')
      );
    } catch (e) {
      toast('Could not apply the scan: ' + e.message, 'error');
    } finally {
      button.disabled = false;
    }
  };
  for (const kind of ['screenshots', 'logs'])
    $('browse-' + kind).onclick = async () => {
      const p = await bridge.pickFolder(kind);
      if (p) $(kind + '-path').value = p;
    };
  $('refresh-logs').onclick = async () => {
    if (!data.settings.logs) {
      toast('Choose the Tarkov logs folder in Connection first.');
      connection();
      return;
    }
    const button = $('refresh-logs'),
      label = button.querySelector('span');
    button.disabled = true;
    label.textContent = 'Updating…';
    try {
      const result = await bridge.refreshLogs();
      unknownQuestDetails = result.unknownQuests || [];
      data = result.data;
      await loadMode();
      updatePosition();
      const current = result.summary[data.mode] || { active: 0, changed: 0 };
      activityUnread += current.changed || 0;
      updateActivityBadge();
      if ($('activity-dialog').open) renderActivity();
      toast('Logs updated · ' + current.active + ' active ' + modeLabel(data.mode) + ' quests.');
    } catch (e) {
      toast(
        'Could not update logs: ' +
          e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
      );
    } finally {
      button.disabled = false;
      label.textContent = 'Logs';
    }
  };
  $('import-catalog').onclick = async () => {
    const button = $('import-catalog'),
      label = button.textContent;
    button.disabled = true;
    button.textContent = 'Checking file…';
    try {
      const preview = await bridge.inspectCatalog(data.mode);
      if (preview) {
        const report = preview.integrity,
          approved = window.confirm(
            'Verified quest catalog:\n\n' +
              report.quests +
              ' quests\n' +
              report.objectives +
              ' objectives\n' +
              report.mapPoints +
              ' map points\n' +
              report.duplicateQuestIds +
              ' duplicate IDs\n\nApply this update?'
          );
        if (approved) {
          allData = await bridge.applyCatalog({ mode: data.mode, token: preview.token });
          await loadMode();
          renderActivity();
          toast('Quest data updated locally · ' + allData.integrity.quests + ' quests verified.');
        }
      }
    } catch (e) {
      toast(
        'Quest data was not imported: ' +
          e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
      );
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  };
  $('export-backup').onclick = async () => {
    try {
      const file = await bridge.exportBackup();
      if (file) toast('Backup exported.');
    } catch (e) {
      toast('Could not export the backup: ' + e.message, 'error');
    }
  };
  $('import-backup').onclick = async () => {
    try {
      const imported = await bridge.importBackup();
      if (imported) {
        data = imported;
        $('profile').value = data.mode;
        await loadMode();
        renderList();
        renderMarkers();
        renderCustomMarkers();
        toast('Backup imported. Your previous file was kept as a recovery copy.');
      }
    } catch (e) {
      toast(
        'Could not import the backup: ' +
          e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
      );
    }
  };
  $('save-connection').onclick = async () => {
    const input = {
      screenshots: $('screenshots-path').value.trim(),
      logs: $('logs-path').value.trim(),
      autoFollow: $('auto-follow').checked
    };
    $('save-connection').disabled = true;
    try {
      data.settings = await bridge.settings(input);
      confirmedFix = null;
      lastFixTime = 0;
      $('connection-dialog').close();
      toast('Connected. Take a new screenshot with the in-game screenshot key.');
    } catch (e) {
      $('connection-error').textContent =
        'Could not connect: ' +
        e.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
    } finally {
      $('save-connection').disabled = false;
    }
  };
  $('open-data').onclick = () => bridge.openData();
  $('about-button').onclick = () => $('about-dialog').showModal();
  $('close-about').onclick = () => $('about-dialog').close();
  lastRaidState = observer.raid || 'unknown';
  bridge.onObserver(state => {
    const fresh = state.position && state.position.observedAt !== observer.position?.observedAt,
      previousRaid = lastRaidState;
    observer = state;
    lastRaidState = state.raid || 'unknown';
    if (previousRaid !== lastRaidState && lastRaidState === 'started') {
      const observedMode = ['pvp', 'pve', 'seasonal'].includes(state.mode) ? state.mode : data.mode,
        observedMap = state.map || state.position?.map || currentMapId;
      adoptObservedSession(observedMode, observedMap);
      bridge
        .raidEvent({
          mode: observedMode,
          type: 'start',
          map: observedMap,
          /* the log line knows when this happened; Date.now() only knows when
             the application got round to reading it */
          at: state.raidAt || Date.now(),
          questIds: quests
            .filter(
              q =>
                data.profiles[observedMode].quests[q.id] === 'active' &&
                q.mapIds.includes(observedMap)
            )
            .map(q => q.id)
        })
        .then(raid => {
          if (raid && !data.profiles[observedMode].raidHistory.some(item => item.id === raid.id))
            data.profiles[observedMode].raidHistory.unshift(raid);
        })
        .catch(() => {});
    } else if (previousRaid === 'started' && lastRaidState === 'ended') {
      const observedMode = ['pvp', 'pve', 'seasonal'].includes(state.mode) ? state.mode : data.mode;
      bridge
        .raidEvent({
          mode: observedMode,
          type: 'end',
          at: state.raidAt || Date.now(),
          outcome: 'unknown'
        })
        .then(raid => {
          if (!raid) return;
          const index = data.profiles[observedMode].raidHistory.findIndex(
            item => item.id === raid.id
          );
          if (index >= 0) data.profiles[observedMode].raidHistory[index] = raid;
          toast('Raid recorded in ' + modeLabel(observedMode) + ' history.');
        })
        .catch(() => {});
    }
    if (
      fresh &&
      state.position.map &&
      state.position.map !== currentMapId &&
      mapDefinitions.some(map => map.id === state.position.map)
    )
      switchMap(state.position.map, { filterQuests: true }).catch(() => updatePosition());
    else updatePosition();
  });
  bridge.onOcrProgress(event => {
    if (event?.status === 'recognizing') {
      const value = Math.round((event.progress || 0) * 100) + '%';
      if (event.context === 'hotkey') {
        if ($('items-dialog').open)
          $('item-catalog-status').textContent = 'Reading item near cursor… ' + value;
      } else if (itemScanRunning || event.context === 'item')
        $('item-catalog-status').textContent = 'Reading item name locally… ' + value;
      else $('scan-summary').textContent = 'Reading the Tasks screen… ' + value;
    }
  });
  bridge.onItemHotkey(updateItemHotkey);
  bridge.onItemHotkeyResult(event => {
    if (!$('items-dialog').open) return;
    $('item-ocr-preview').textContent = event.textPreview || 'No text recognized.';
    renderItemResults(event.matches || [], { scanned: true });
    itemCatalogStatus();
  });
  bridge.onQuestProgress(event => {
    const p = data.profiles[event.mode];
    if (!p) return;
    p.quests[event.id] = event.status;
    p.questSources ||= {};
    p.questSources[event.id] = 'logs';
    p.questSync ||= { seenEvents: [], lastEventAt: null, history: [] };
    p.questSync.lastEventAt = event.observedAt;
    p.questSync.history ||= [];
    if (!p.questSync.history.some(item => item.eventId === event.eventId)) {
      p.questSync.history.unshift({
        eventId: event.eventId,
        id: event.id,
        status: event.status,
        observedAt: event.observedAt,
        source: 'logs'
      });
      p.questSync.history = p.questSync.history.slice(0, 100);
    }
    if (event.mode === data.mode) {
      const q = quests.find(item => item.id === event.id);
      activityUnread++;
      updateActivityBadge();
      renderList();
      renderMarkers();
      if (myRaidOpen) renderMyRaid(false);
      else if (selected?.id === event.id) renderDetail();
      if ($('activity-dialog').open) renderActivity();
      toast(questEventMessage(q, event.status));
    }
  });
  updateActivityBadge();
  setInterval(updateAge, 1000);
  /* A <select> keeps focus after you pick from it, and a focused select eats
     single-letter shortcuts - it spends them on type-ahead, so F in the map
     picker jumps to Factory instead of focusing the map. Picking a map is the
     first thing anyone does here, which left F looking broken from then on.

     Focus goes back to the document after a change the pointer started. A
     keyboard user keeps it, because they are still navigating the control and
     taking focus away mid-arrow would be far worse than a dead shortcut. */
  let selectReachedByPointer = null;
  document.addEventListener(
    'pointerdown',
    event => {
      selectReachedByPointer =
        event.target instanceof Element ? event.target.closest('select') : null;
    },
    true
  );
  document.addEventListener(
    'change',
    event => {
      if (event.target instanceof HTMLSelectElement && event.target === selectReachedByPointer) {
        event.target.blur();
        selectReachedByPointer = null;
      }
    },
    true
  );

  document.addEventListener('keydown', e => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName),
      dialogOpen = !!document.querySelector('dialog[open]');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette();
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !typing && !dialogOpen) {
      /* The rail shows eight quests at a time and selecting one is now the
         main thing you do on this screen, so it is worth a key. Nothing else
         binds the arrows outside the command palette, and that counts as
         typing. */
      const rows = [...$('quest-list').querySelectorAll('.quest-row')];
      if (!rows.length) return;
      e.preventDefault();
      const at = rows.findIndex(row => row.classList.contains('selected'));
      const next =
        e.key === 'ArrowDown'
          ? Math.min(rows.length - 1, at + 1)
          : Math.max(0, (at === -1 ? rows.length : at) - 1);
      rows[next].click();
      /* Selecting re-renders the list, so the row that was clicked is gone by
         the time it needs scrolling into view. */
      requestAnimationFrame(() => {
        const now = $('quest-list').querySelector('.quest-row.selected');
        if (!now) return;
        /* Selection moved but focus did not, so Tab carried on from the top of
           the page and a screen reader was told nothing had happened. The row
           is a button carrying the quest name and `aria-pressed`, so putting
           focus on it says the right thing. Scroll it deliberately rather than
           letting focus do it, which jumps. */
        now.focus({ preventScroll: true });
        now.scrollIntoView({ block: 'nearest' });
      });
      return;
    }
    if (e.key === '/' && !typing && !dialogOpen) {
      e.preventDefault();
      $('quest-search').focus();
      return;
    }
    if (e.key.toLowerCase() === 'f' && !typing && !dialogOpen) {
      e.preventDefault();
      setMapFocus(!mapFocus);
      return;
    }
    if (e.key === 'Escape' && !dialogOpen) {
      /* A ladder, most transient first, one rung per press. Escape used to
         leave map focus before closing a popup, so a popup opened while
         focused took two presses and threw away the focus to get rid of one
         card. The brief joined the ladder when it became a floating card:
         before that it was a column you toggled, and a column you are not
         looking at costs nothing, but a card lying over the map does. */
      const drawer = document.querySelector('.layer-disclosure[open]');
      const popup = $('map-popup');
      if (!popup.hidden) popup.hidden = true;
      else if (drawer) drawer.open = false;
      else if (railLayout.matches && !detailsCollapsed) setDetailsCollapsed(true);
      else if (mapFocus) setMapFocus(false);
    }
  });
  if (boot.storageError) toast(boot.storageError, 'error');
  else if (boot.logRefresh?.error)
    toast('Automatic log update failed: ' + boot.logRefresh.error, 'error');
  else if (boot.logRefresh?.summary?.[data.mode]?.changed) {
    activityUnread = boot.logRefresh.summary[data.mode].changed;
    updateActivityBadge();
    toast(
      'Logs updated automatically · ' +
        activityUnread +
        ' quest change' +
        (activityUnread === 1 ? '' : 's') +
        '.'
    );
  }
}
start().catch(e => {
  $('map-loading').hidden = false;
  $('map-loading').textContent = 'Could not load the local map data. Restart the app.';
  console.error(e);
});
