/*
 * my-raid, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { focusRaid, saveRaidPreferences, selectQuest } from './app.js';
import { describeBrief } from './quest-brief.js';
import { renderList } from './quest-list.js';
import { keyIconFor } from './keys.js';
import { $, el, toast, uiIcon } from './dom.js';

import { carryActions } from './vocabulary.js';
import { keyDoorButton } from './doors.js';

import { renderMarkers } from './markers.js';
import { floorFor, floorName } from './floors.js';
import { focusQuest, setDetailsCollapsed } from './view.js';
import { assignMyRaidOpen, assignSelected, currentMapId, mapDefinitions } from './state.js';
import {
  activeMapQuests,
  collectRequirement,
  hiddenOnCurrentMap,
  isDone,
  mapName,
  objectiveOnCurrentMap,
  objectivePoints,
  profile,
  questMarkerMeta
} from './quest-state.js';

export function ensureRaidData() {
  const p = profile();
  p.raidHidden ||= {};
  p.customMarkers ||= {};
  p.raidHidden[currentMapId] ||= [];
  p.customMarkers[currentMapId] ||= [];
  return p;
}

export function visibleRaidQuests() {
  const hidden = hiddenOnCurrentMap();
  return activeMapQuests().filter(q => !hidden.has(q.id));
}
/* Renderer-only, the way Battle Pass category visibility is: it decides what
   is drawn and nothing else, so putting it in progress.json would mean a new
   key in the map-layers validator, a default in the profile shape and a
   migration for everyone who already has a saved file - three places to get
   wrong for a checkbox about drawing. */

export function raidKit(questList) {
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

/* Which of the active quests on this map actually send you somewhere.
 *
 * Measured across this profile, 53 of 89 My Raid rows - 60% - draw nothing
 * on the map at all: kill counts, extractions, hand-ins. They are correctly
 * active and worth knowing about, but they sat mixed in with the ones that
 * name a place, so the glance you take before a raid was ten rows deep to
 * find the three that tell you where to go. On Lighthouse it was eleven of
 * seventeen.
 */
export function questHasPointsHere(q) {
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

/* And of the ones that do: can this quest be finished without going
 * anywhere else? A quest is answered here when no objective it still needs
 * demands a different map. On Streets that is one quest in six, which is
 * the sort of thing you want to know before you load in rather than after.
 *
 * An objective with no mapIds at all is unconstrained - "survive and
 * extract", "hand over to the trader" - so it never blocks. An optional one
 * does not block either, by definition.
 */
export function elsewhereMaps(q) {
  const needed = new Set();
  for (const o of q.objectives) {
    if (o.optional || isDone(o)) continue;
    const ids = o.mapIds || [];
    if (!ids.length || ids.includes(currentMapId)) continue;
    for (const id of ids) if (mapDefinitions.some(m => m.id === id)) needed.add(id);
  }
  return [...needed];
}

export function renderMyRaid(focus = false) {
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
       group says it once; the row says where to go - or, when there is
       nowhere, what it wants instead.

       36 of this profile's 63 active quests have no point on any map, and
       their first outstanding objective is the thing you would actually plan
       around: "Eliminate 20 PMCs with AK-12 with the proprietary suppressor"
       is a loadout decision, and the row was showing only a trader name. */
    if (!points) {
      const next = q.objectives.find(o => !o.optional && !isDone(o)) || q.objectives[0];
      if (next) open.append(el('small', 'raid-wants', next.description));
    }
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

export function showActiveQuests() {
  const currentName = mapName(currentMapId),
    active = activeMapQuests();
  assignMyRaidOpen(true);
  assignSelected(null);
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
