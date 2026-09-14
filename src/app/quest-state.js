/*
 * quest-state, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { $, el } from './dom.js';
import { ensureRaidData } from './my-raid.js';
import { currentMapId, data, mapDefinitions, quests, traderCatalog } from './state.js';
import {
  objectiveMapCounts,
  objectiveTarget,
  questColors,
  questShape,
  statusRank,
  traderInitials
} from './vocabulary.js';

import { renderMarkers, scheduleDeclutter } from './markers.js';
import { focusQuest } from './view.js';
import { switchMap } from './map-load.js';

export function profile() {
  return data.profiles[data.mode];
}

export function status(q) {
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
export function requirementMet(item) {
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
/* The highest level gate among the quests you have taken on or finished. You
   cannot hold a quest you were too low for, so this is a floor the catalogue
   proves rather than a number anyone had to type. Measured on this profile it
   reads 38, from Bullshit being active. */

export function provenLevel() {
  let floor = 0;
  for (const q of quests) {
    const state = status(q);
    if ((state === 'completed' || state === 'active') && (q.minPlayerLevel || 0) > floor)
      floor = q.minPlayerLevel;
  }
  return floor;
}
/* Why a quest is offered, or the empty string when it is not. Two honest
   reasons, and they are different claims:
     'prerequisites'  every quest it waits on is in the state it wants
     'nothing known'  it waits on no quest, and its level gate is behind you */

export function availableBecause(q) {
  if (status(q) !== 'untracked') return '';
  /* Story chapters and the Battle Pass tracker are this application's own
     groupings, not something a trader hands you, so "available now" is not a
     question about them. They carry a category and the 492 real quests carry
     none, which is what makes this a test rather than a name match. Without
     it they sail in: no prerequisites and no level gate is exactly their
     shape, and all 11 appeared the first time this ran. */
  if (q.category) return '';
  if ((q.minPlayerLevel || 0) > provenLevel()) return '';
  const needs = q.requirements || [];
  if (needs.length) return needs.every(requirementMet) ? 'prerequisites' : '';
  /* A quest with no prerequisite used to be dropped here, on the grounds that
     it was gated on trader loyalty and player level. Half of that was wrong:
     43 of this profile's 72 such quests carry no level gate at all, and the
     level gate on the rest is now checked against provenLevel(). What is left
     is loyalty - and no bundled file records loyalty for ANY quest, including
     the ones this function has always returned. Dropping these for a reason
     that was never applied to the others was inconsistent, not careful. */
  return 'nothing known';
}

export function questAvailable(q) {
  return availableBecause(q) !== '';
}

export function unlockedByNames(q) {
  return (q.requirements || [])
    .map(item => quests.find(dep => dep.id === item.taskId)?.name)
    .filter(Boolean);
}

export function source(q) {
  if (profile().questSources?.[q.id]) return profile().questSources[q.id];
  return (q.sourceQuestIds || []).some(id => profile().questSources?.[id] === 'logs')
    ? 'logs'
    : null;
}
// Objective ids are not stamped with their quest, so completing a quest left every
// one of its objectives reading as undone: a profile with 188 finished quests still
// showed "0 / 1797 objectives". This index gives isDone the missing link.

// Objective ids are not stamped with their quest, so completing a quest left every
// one of its objectives reading as undone: a profile with 188 finished quests still
// showed "0 / 1797 objectives". This index gives isDone the missing link.
export let objectiveOwner = new Map();

export function indexObjectiveOwners() {
  objectiveOwner = new Map();
  for (const q of quests) for (const o of q.objectives) objectiveOwner.set(o.id, q.id);
}
/* A seam the renderer harness needs and modules took away. It used to test
   the finished-objective drawing by replacing the global isDone, which worked
   while this file was a classic script; module scope makes that impossible,
   and the alternative - writing a real objective record - is saved progress
   the harness must never touch. So the override is explicit, null in every
   normal run, and one property read on a path that is already doing map
   lookups. */

export let isDoneOverride = null;
/* The harness reaches this through window.isDoneOverride. A setter rather than
   a bare assignment because an importer may read a `let` export but never
   rebind it. */

export function assignIsDoneOverride(fn) {
  isDoneOverride = fn;
}
/* The dispatcher and the real answer are separate on purpose. A harness that
   takes isDone, then installs an override that falls back to what it took,
   would call the dispatcher from inside the dispatcher - which is exactly the
   stack overflow the first version of this produced. Delegate to
   isDoneRecorded instead. */

export function isDone(o) {
  return isDoneOverride ? isDoneOverride(o) : isDoneRecorded(o);
}

export function isDoneRecorded(o) {
  if (profile().objectives[o.id]) return true;
  if (o.sourceQuestId && profile().quests[o.sourceQuestId] === 'completed') return true;
  const questId = objectiveOwner.get(o.id);
  return !!questId && profile().quests[questId] === 'completed';
}

/* Whether anything is KNOWN about this objective, which is a different
   question from whether it is done. The logs carry quest status and never
   condition state, so an objective on an active quest is usually unrecorded -
   and reporting that as "0 done" is a claim the application cannot support. */
export function objectiveStateKnown(o) {
  if (profile().objectives[o.id] || profile().objectiveProgress?.[o.id]) return true;
  if (o.sourceQuestId && profile().quests[o.sourceQuestId] === 'completed') return true;
  const questId = objectiveOwner.get(o.id);
  return !!questId && profile().quests[questId] === 'completed';
}

export function objectiveProgress(o) {
  const saved = profile().objectiveProgress?.[o.id],
    target = saved?.target || objectiveTarget(o);
  return {
    value: Math.min(saved?.value ?? (isDone(o) ? target : 0), target),
    target,
    confirmed: saved?.confirmed ?? isDone(o),
    source: saved?.source || 'manual'
  };
}

export function requirementId(req) {
  return typeof req === 'string' ? null : req?.questId || req?.taskId || req?.id || null;
}

export function unlockedBy(id) {
  return quests.filter(q => (q.requirements || []).some(req => requirementId(req) === id));
}

export function mapName(id) {
  const known = mapDefinitions.find(map => map.id === id)?.displayName;
  return (
    known ||
    id
      .split('-')
      .map(word => word[0]?.toUpperCase() + word.slice(1))
      .join(' ')
  );
}

export function questMaps(q) {
  return q.mapIds?.length ? q.mapIds.map(mapName).join(', ') : 'Any location';
}

export function activeMapQuests() {
  /* A quest you have hidden should not be on the map either - hiding it in the
     list and leaving its markers on the artwork would be the worst of both. */
  const hiddenQuests = new Set(profile().hiddenQuests || []);
  return quests.filter(
    q => status(q) === 'active' && q.mapIds.includes(currentMapId) && !hiddenQuests.has(q.id)
  );
}

export function hiddenOnCurrentMap() {
  return new Set(ensureRaidData().raidHidden[currentMapId]);
}

export const hideDoneKey = 'tarkoveyes-hide-done-objectives-v1';

export let hideDoneObjectives = false;

export function loadHideDone() {
  try {
    hideDoneObjectives = localStorage.getItem(hideDoneKey) === '1';
  } catch {
    hideDoneObjectives = false;
  }
  const box = $('layer-hide-done');
  if (box) box.checked = hideDoneObjectives;
}

export function setHideDone(value) {
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

export function doneObjectivesOnMap() {
  let total = 0;
  for (const q of activeMapQuests())
    for (const p of objectivePoints(q)) if (isDone(p.objective)) total++;
  return total;
}
/* Nine quest names appear more than once, and in the rail they were
 * indistinguishable: same name, same trader, nothing to tell them apart.
 * Make Amends appears three times. 17 such rows are visible here under the
 * default filter.
 *
 * They are two different things and need two different answers.
 *
 * **BEAR and USEC** are one quest per faction - Drip-Out and Textile, four
 * names, twelve quests - and you can only ever do one of each pair. The tag
 * is the faction.
 *
 * **The rest are simply different tasks that share a name** - Battery Change,
 * Make Amends, The Huntsman Path - Administrator, The Price of Independence,
 * The Tarkov Shooter - Part 5. What separates those is where they send you,
 * so the tag is the map.
 *
 * Computed once per render rather than per row: it is a walk of five hundred
 * quests and the list redraws on every filter change.
 */
/* Looking at what actually differs inside each group turns nine names into
 * three cases:
 *
 *   faction     Drip-Out 1 and 2, Textile 1 and 2 - one quest per faction,
 *               and you can only ever do one of each pair.
 *   same name,  The Tarkov Shooter - Part 5 (Customs / Streets), The
 *   other map   Huntsman Path - Administrator (Reserve / Lighthouse).
 *   identical   Make Amends x3, Battery Change x2, The Price of Independence
 *               x2 - same trader, same maps, same objective text, different
 *               id. The same quest listed more than once upstream.
 *
 * The first two get a tag. The third cannot: tagging three identical rows
 * "Lighthouse" three times is the original complaint with extra ink. They
 * collapse to one row instead, carrying the strongest status in the group,
 * because that is what they are.
 */
/* Split so each can be exported. quest-list.js reads collapsedAway, and a
   multi-declaration cannot be exported name by name - which is also why the
   import scan missed it and the list rendered nothing, with the ReferenceError
   swallowed by the caller. */

export let duplicateNames = null;

export let collapsedAway = null;

export function refreshDuplicateNames() {
  const seen = new Map();
  for (const q of quests) seen.set(q.name, (seen.get(q.name) || 0) + 1);
  duplicateNames = new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));

  /* Identical records collapse to whichever one the profile knows most
     about, so a row never loses a status a sibling was carrying. */
  const groups = new Map();
  for (const q of quests) {
    if (!duplicateNames.has(q.name)) continue;
    const key = questShape(q);
    const kept = groups.get(key);
    if (!kept || (statusRank[status(q)] || 0) > (statusRank[status(kept)] || 0)) groups.set(key, q);
  }
  collapsedAway = new Set();
  for (const q of quests) {
    if (!duplicateNames.has(q.name)) continue;
    const kept = groups.get(questShape(q));
    if (kept && kept.id !== q.id) collapsedAway.add(q.id);
  }
}

export function questTag(q) {
  if (!duplicateNames?.has(q.name)) return null;
  if (q.faction) return q.faction;
  /* The map only tells them apart if the twins are on different maps. Make
     Amends is on Lighthouse three times, and saying so three times is the
     complaint restated - those collapse instead. */
  const twins = quests.filter(other => other.name === q.name && other.id !== q.id);
  const maps = (q.mapIds || []).filter(id => mapDefinitions.some(m => m.id === id));
  if (maps.length !== 1) return null;
  const mine = maps[0];
  return twins.some(other => (other.mapIds || []).includes(mine)) ? null : mapName(mine);
}
/* Which faction you play, derived rather than asked for: you can only
   complete a quest that belongs to yours, so one finished half of any
   BEAR/USEC pair settles it. Undefined until you have finished one. */

export function playerFaction() {
  for (const q of quests) if (q.faction && status(q) === 'completed') return q.faction;
  return null;
}

export function questMarkerMeta(q) {
  const index = activeMapQuests().findIndex(item => item.id === q.id);
  return {
    number: index < 0 ? null : index + 1,
    color: questColors[Math.max(0, index) % questColors.length]
  };
}

export function objectivePoints(q, onlyId = null) {
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

export function mappedElsewhere(objectives) {
  const counts = objectiveMapCounts(objectives);
  counts.delete(currentMapId);
  let best = null;
  for (const [id, count] of counts) {
    if (!mapDefinitions.some(map => map.id === id)) continue;
    if (!best || count > best.count) best = { id, count };
  }
  return best;
}

export async function openQuestOnMap(q, mapId, onlyId) {
  await switchMap(mapId);
  if (currentMapId !== mapId) return;
  focusQuest(q, onlyId);
}

export function objectiveOnCurrentMap(o) {
  return !o.mapIds?.length || o.mapIds.includes(currentMapId);
}

export function collectRequirement(store, label, quest, objective, extra) {
  const entry = store.get(label) || { label, quests: new Set(), optional: true, ...extra };
  entry.quests.add(quest.name);
  if (!objective.optional) entry.optional = false;
  store.set(label, entry);
}

export function questKeyList(q) {
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

export function traderBadge(quest) {
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
