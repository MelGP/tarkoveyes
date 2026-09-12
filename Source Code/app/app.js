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
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 4500);
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
  return quests.filter(q => status(q) === 'active' && q.mapIds.includes(currentMapId));
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
    collector = pathFilter === 'collector' ? collectorPath() : null,
    lightkeeper = pathFilter === 'lightkeeper' ? lightkeeperPath() : null;
  const matching = quests.filter(
    q =>
      (!map || q.mapIds.includes(map)) &&
      (!trader || q.traderName === trader) &&
      (filter === 'all' ||
        (filter === 'open' && status(q) !== 'completed') ||
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
    row.setAttribute('aria-label', q.name);
    row.setAttribute('aria-pressed', String(q.id === selected?.id));
    const body = el('div', 'quest-copy');
    body.append(el('strong', '', q.name));
    const markerCount = objectivePoints(q).length;
    body.append(
      el(
        'small',
        '',
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
    if (source(q) === 'logs') body.append(el('small', 'log-source', 'Updated from logs'));
    const badge = traderBadge(q);
    const statusDot = el('span', 'quest-status ' + status(q));
    statusDot.title = status(q);
    statusDot.setAttribute('aria-hidden', 'true');
    const arrow = uiIcon('chevron');
    arrow.classList.add('quest-arrow');
    row.title = q.name + ' — ' + q.traderName + ' · ' + questMaps(q) + ' · ' + status(q);
    row.append(badge, body, statusDot, arrow);
    row.onclick = () => selectQuest(q);
    $('quest-list').append(row);
  });
  $('quest-count').textContent = matching.length;
  const filterSummary = $('filter-summary');
  if (filterSummary) {
    const parts = [];
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
function setDetailsCollapsed(collapsed) {
  detailsCollapsed = !!collapsed;
  const main = document.querySelector('main');
  main.classList.toggle('details-collapsed', detailsCollapsed);
  $('toggle-details').classList.toggle('active', !detailsCollapsed);
  $('toggle-details').setAttribute('aria-expanded', String(!detailsCollapsed));
  $('toggle-details').title = detailsCollapsed ? 'Show quest details' : 'Hide quest details';
  requestAnimationFrame(() => setView());
}
function setMapFocus(active) {
  mapFocus = !!active;
  document.querySelector('main').classList.toggle('map-focus', mapFocus);
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
function selectQuest(q) {
  myRaidOpen = false;
  selected = q;
  setDetailsCollapsed(false);
  renderList();
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
    toast('Could not save quest visibility.');
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
      toast('Could not save progress. Check available disk space.');
    }
  };
  stateRow.append(select);
  head.append(stateRow);
  panel.append(head);
  const questKeys = questKeyList(q);
  if (questKeys.length) {
    const gear = el('div', 'detail-section');
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
  const section = el('div', 'detail-section'),
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
        toast('Could not save the objective.');
      }
    };
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
          toast('Could not save the counter.');
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
    row.append(check, body);
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
function markerScale() {
  const box = $('map-svg').getBoundingClientRect();
  return Math.max(view.w / box.width, view.h / box.height);
}
function makeMarker(p, label, color, shape = 'extract', candidate = false, number = null) {
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
  if (shape === 'cluster') {
    g.append(svg('circle', { r: 17, fill: '#151d20', stroke: '#f4c980', 'stroke-width': 2 }));
    g.append(svg('circle', { r: 13, fill: '#574725', 'fill-opacity': '.55' }));
    const t = svg('text', {
      x: 0,
      y: 3.3,
      fill: '#f4c980',
      'font-size': number > 9 ? 7 : 9,
      'font-weight': 700,
      'text-anchor': 'middle'
    });
    t.textContent = number;
    g.append(t);
  } else if (shape === 'quest') {
    g.append(
      svg('circle', {
        r: 14,
        fill: color,
        'fill-opacity': '.13',
        stroke: color,
        'stroke-width': 1,
        'stroke-dasharray': candidate ? '3 3' : ''
      })
    );
    g.append(svg('circle', { r: 9, fill: '#172020', stroke: color, 'stroke-width': 2 }));
    const t = svg('text', {
      x: 0,
      y: 3.2,
      fill: color,
      'font-size': number && number > 9 ? 7 : 9,
      'font-weight': 700,
      'text-anchor': 'middle'
    });
    t.textContent = number || '•';
    g.append(t);
  } else {
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
      const g = makeMarker(
          unique[0].p,
          unique.length + ' overlapping quest objectives',
          '#f4c980',
          'cluster',
          false,
          unique.length
        ),
        floors = unique.map(entry => floorFor(entry.p));
      g.setAttribute('opacity', floors.includes(floor) ? '1' : '.55');
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
      color = meta.number ? meta.color : isDone(p.objective) ? '#82c7a7' : '#f4c980',
      g = makeMarker(
        p,
        (meta.number ? 'Quest ' + meta.number + ': ' : '') +
          q.name +
          ' — ' +
          p.objective.description,
        color,
        'quest',
        p.candidate,
        meta.number
      ),
      f = floorFor(p);
    g.setAttribute('opacity', floor === f ? '1' : '.55');
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
function lootEntries() {
  if (!lootData) return [];
  const entries = [],
    containers = new Set(containerLayers.filter(([, id]) => $(id)?.checked).map(([key]) => key)),
    loose = new Set(looseLayers.filter(([, id]) => $(id)?.checked).map(([key]) => key));
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
    if (floorFor(entry.position) !== floor) continue;
    const projected = point(entry.position);
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
    const entriesHere = group.entries,
      position =
        entriesHere.length === 1
          ? group.projected
          : {
              x:
                entriesHere.reduce((n, entry) => n + point(entry.position).x, 0) /
                entriesHere.length,
              y:
                entriesHere.reduce((n, entry) => n + point(entry.position).y, 0) /
                entriesHere.length
            };
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
  const candidates = [];
  for (const [id, rank] of markerRanks) {
    const group = $(id);
    if (!group) continue;
    for (const node of group.children) {
      node.classList.remove('crowded');
      const box = node.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const kind = node.dataset.kind;
      candidates.push({
        node,
        rank: id === 'markers' && kind !== 'quest' && kind !== 'cluster' ? wayoutRank : rank,
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        reach: Math.max(box.width, box.height) / 2
      });
    }
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
          toast('Could not delete the marker.');
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
  box.append(
    el(
      'p',
      'raid-stats',
      visible.length + ' shown · ' + pts.length + ' map point' + (pts.length === 1 ? '' : 's')
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
  active.forEach(q => {
    const meta = questMarkerMeta(q),
      card = el('div', 'raid-quest-card' + (hidden.has(q.id) ? ' muted-card' : '')),
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
    open.append(
      el(
        'small',
        'raid-floor',
        points
          ? points +
              ' map point' +
              (points === 1 ? '' : 's') +
              (floors.length ? ' · ' + floors.join(', ') : '')
          : 'No fixed map point'
      )
    );
    open.onclick = () => {
      selectQuest(q);
      if (points) focusQuest(q);
    };
    card.append(toggle, number, open);
    box.append(card);
  });
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
  if (focus) focusRaid(visible);
}
function showActiveQuests() {
  const currentName = mapName(currentMapId),
    active = activeMapQuests();
  myRaidOpen = true;
  selected = null;
  setDetailsCollapsed(false);
  $('map-filter').value = currentMapId;
  $('status-filter').value = 'active';
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
    toast('Could not save map layer preferences.');
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
function centeredView(p, w = view.w, h = view.h) {
  return {
    x: w >= W ? (W - w) / 2 : Math.max(0, Math.min(W - w, p.x - w / 2)),
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
          ? 'logs synced'
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
  for (const [label, value, total, color] of [
    ['Quests', done, quests.length, '#97d5af'],
    ['Objectives', objectiveDone, objectiveTotal, '#f4c980'],
    ['Tracked quests', active + done + failed, quests.length, '#83c8e8'],
    ['Kappa route', ...routeRow(kappa, '#d8b06a')],
    ['Lightkeeper route', ...routeRow(lightkeeper, '#9fb8d8')]
  ].filter(row => row[2] > 0)) {
    const row = el('div', 'dashboard-progress');
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
    toast('Could not open that result: ' + error.message)
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
    setView();
  };
  viewport.onpointerup = () => (drag = null);
  viewport.onpointercancel = () => (drag = null);
  function zoom(factor, p = { x: view.x + view.w / 2, y: view.y + view.h / 2 }) {
    const next = Math.max(60, Math.min(W * 2, view.w * factor)),
      ratio = next / view.w;
    view = {
      x: p.x - (p.x - view.x) * ratio,
      y: p.y - (p.y - view.y) * ratio,
      w: next,
      h: view.h * ratio
    };
    setView();
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
  window.addEventListener('resize', () => setView());
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
    quests.filter(q => q.mapIds.includes(id)).length + ' quests · Norvinsk region';
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
      quests.filter(q => q.mapIds.includes(currentMapId)).length + ' quests · Norvinsk region';
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
      favorites: []
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
        save();
      },
      customMarkers: async input => {
        d.profiles[input.mode].customMarkers[input.map] = input.markers;
        save();
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
    favorites: []
  };
  for (const mode of ['pvp', 'pve', 'seasonal']) {
    const p = data.profiles[mode];
    p.questSources ||= {};
    p.questSync ||= { seenEvents: [], lastEventAt: null, lastScanAt: null, history: [] };
    p.questSync.history ||= [];
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
  updateLayerChildren();
  [
    mapDefinitions,
    questImages,
    bossSpawnRates,
    bossCatalog,
    traderCatalog,
    keyCatalog,
    labKeycards,
    specialTracks
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
    fetch('data/special-tracks.json').then(r => r.json())
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
  for (const id of ['quest-search', 'map-filter', 'trader', 'status-filter'])
    $(id).addEventListener(id === 'quest-search' ? 'input' : 'change', renderList);
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
      toast('Could not load that bundled map.');
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
      toast(
        'Switched to ' +
          (next === 'seasonal' ? 'Seasonal/Kord Breach' : next.toUpperCase()) +
          ' progress.'
      );
    } catch {
      toast('Could not switch profiles.');
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
      toast('Could not change the inventory shortcut.');
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
      toast('Could not save the loot threshold.');
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
      $('scan-dialog').close();
      if (selected) renderDetail();
      renderList();
      renderMarkers();
      toast(
        chosen.length +
          ' objective update' +
          (chosen.length === 1 ? '' : 's') +
          ' applied. Completed steps are confirmed; partial counts remain reviewable.'
      );
    } catch (e) {
      toast('Could not apply the scan: ' + e.message);
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
      toast(
        'Logs updated · ' +
          current.active +
          ' active ' +
          (data.mode === 'seasonal' ? 'Seasonal/Kord Breach' : data.mode.toUpperCase()) +
          ' quests.'
      );
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
      toast('Could not export the backup: ' + e.message);
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
      bridge
        .raidEvent({
          mode: observedMode,
          type: 'start',
          map: observedMap,
          at: Date.now(),
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
        .raidEvent({ mode: observedMode, type: 'end', at: Date.now(), outcome: 'unknown' })
        .then(raid => {
          if (!raid) return;
          const index = data.profiles[observedMode].raidHistory.findIndex(
            item => item.id === raid.id
          );
          if (index >= 0) data.profiles[observedMode].raidHistory[index] = raid;
          toast(
            'Raid recorded in ' +
              (observedMode === 'seasonal' ? 'Seasonal/Kord Breach' : observedMode.toUpperCase()) +
              ' history.'
          );
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
  document.addEventListener('keydown', e => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName),
      dialogOpen = !!document.querySelector('dialog[open]');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette();
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
      if (mapFocus) setMapFocus(false);
      else $('map-popup').hidden = true;
    }
  });
  if (boot.storageError) toast(boot.storageError);
  else if (boot.logRefresh?.error) toast('Automatic log update failed: ' + boot.logRefresh.error);
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
