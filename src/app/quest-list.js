/*
 * quest-list, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { currentMapId, quests, selected } from './state.js';
import { collectorPath, lightkeeperPath } from './quest-routes.js';
import { selectQuest } from './app.js';
import { scheduleBriefAlign } from './quest-brief.js';
import { $, el, uiIcon } from './dom.js';
import {
  collapsedAway,
  mapName,
  objectivePoints,
  playerFaction,
  profile,
  questAvailable,
  questMaps,
  questTag,
  refreshDuplicateNames,
  source,
  status,
  traderBadge
} from './quest-state.js';

export function renderList() {
  refreshDuplicateNames();
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
      /* An exact duplicate of a row already in the list adds nothing but a
         second identical line to read past. */
      !collapsedAway?.has(q.id) &&
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
    /* Only where the name is ambiguous. A tag on every row would be noise,
       and these are 17 rows out of five hundred. */
    const tag = questTag(q);
    if (tag) {
      const mark = el('span', 'quest-tag', tag);
      /* The faction you cannot play is the one you can ignore, so it is
         quieter rather than hidden - hiding it would make the pair look like
         a single quest again. */
      if (q.faction && playerFaction() && q.faction !== playerFaction())
        mark.classList.add('other-faction');
      nameEl.append(mark);
    }
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

/* Choosing a quest moves a class between two rows. It used to rebuild the whole
 * list to do it, which is fine for the eleven rows an average map filter shows
 * and is not fine at all for the 503 rows "All quests" shows - 16.8ms, on every
 * arrow key. Nothing renderList() reads changes when the selection does:
 * the search text, the map, the trader, the status and the path filter are all
 * exactly as they were.
 */
export let listRenderTimer = 0;

export function scheduleListRender() {
  clearTimeout(listRenderTimer);
  listRenderTimer = setTimeout(renderList, 110);
}

export function markSelectedRow() {
  for (const row of $('quest-list').querySelectorAll('.quest-row')) {
    const chosen = row.dataset.questId === selected?.id;
    row.classList.toggle('selected', chosen);
    row.setAttribute('aria-pressed', String(chosen));
  }
  scheduleBriefAlign();
}
