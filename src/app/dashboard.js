/*
 * dashboard, lifted out of app.js.
 *
 * Imports from app.js and app.js imports back. That cycle is safe here
 * because nothing is used while the modules evaluate - every one of these is
 * called later, from an event handler or from start().
 */
import { $, el } from './dom.js';
import { collectorPath, lightkeeperPath } from './quest-routes.js';
import { renderList } from './quest-list.js';
import { chainColumn, renderNextSteps } from './chain.js';
import { allData, data, mapDefinitions, quests } from './state.js';
import {
  isDone,
  mapName,
  profile,
  questAvailable,
  requirementId,
  status,
  unlockedBy
} from './quest-state.js';

/* What 67 recorded raids can honestly say.
 *
 * Deliberately NOT a survival rate: across 132 log folders the only
 * userMatchOver.status values are Free and Transfer, which describe the match
 * slot and not whether you lived, so every raid is filed as outcome unknown.
 * A survival percentage here would be invented, and the panel says so instead
 * of leaving a gap that looks like a bug. */
export function raidStatsPanel(p) {
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

/* The brief already names what a quest needs and what it unlocks, one step in
 * each direction. That answers "what is next" and not "how far in am I", which
 * is the question with 503 quests and 192 done.
 *
 * This walks the whole chain both ways and groups it by distance, so a quest
 * reads as a position in a line of work rather than a pair of neighbours.
 * Breadth-first with a seen set: the graph has diamonds - two prerequisites
 * that share a grandparent - and a depth-first walk would print those twice
 * and, where a catalog has a cycle, not stop. */
export function questChainLayers(quest) {
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

/* A whole route, rather than one quest and its neighbours. The bands are
 * `chainDepth` from the catalogue - how many quests deep into its own line a
 * quest sits - so the view runs from the openers to the last one, and where
 * you are on it is the colour of the dots.
 *
 * Clicking a quest here opens its own chain, so the two views are a way
 * through each other rather than two dead ends. */
export function renderQuestSet(label, ids, note, summary) {
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

export function renderDashboard() {
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
  /* A quest whose every recorded prerequisite is satisfied and that the
     application has no record of is one this trader can hand you now. It is
     the same derivation the Available now filter uses; what is new is saying
     WHO is holding them, which is the form you can act on before you log in.
     Measured here: 23 across eight traders, four of them at Therapist. */
  const waiting = new Map();
  for (const q of quests.filter(questAvailable))
    waiting.set(q.traderName, (waiting.get(q.traderName) || 0) + 1);
  for (const trader of traders) {
    const list = quests.filter(q => q.traderName === trader),
      complete = list.filter(q => status(q) === 'completed').length,
      ready = waiting.get(trader) || 0,
      row = el('button', 'dashboard-link');
    row.append(el('span', '', trader));
    /* Only where there is something to collect - a zero on every other row
       would be eleven ways of saying nothing. */
    if (ready) row.append(el('span', 'trader-waiting', ready + ' waiting'));
    row.append(el('small', '', complete + ' / ' + list.length));
    row.onclick = () => {
      $('dashboard-dialog').close();
      $('trader').value = trader;
      /* Clicking a trader who has something waiting shows you that, rather
         than their whole history - which is what you came to the row for. */
      if (ready) $('status-filter').value = 'available';
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
/* The dashboard's "Ready to start" and the Available now filter are the same
   question, and they used to answer it with two different functions that
   disagreed - 103 against 20 on this profile. This one had its own rules and
   all of them were looser:
     - `[].every()` is true, so quests with no prerequisite passed silently,
       which is where most of the 103 came from;
     - it never looked at `minPlayerLevel`, so it offered quests gated above
       the level the catalogue proves you have;
     - it never looked at `category`, so Story chapters and the Battle Pass
       tracker were in it;
     - and it accepted only `completed`, missing the requirements that want a
       predecessor `active` or `failed`, which requirementMet handles.
   One derivation now. The sort is the part worth keeping: shallowest chain
   first, so a route's opening quest leads. */

export function readyToStart() {
  return quests
    .filter(questAvailable)
    .sort((a, b) => (a.chainDepth ?? 99) - (b.chainDepth ?? 99) || a.name.localeCompare(b.name));
}

export function mapWorkload() {
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

export function dashboardPanel(title, note) {
  const panel = el('div', 'dashboard-panel');
  panel.append(el('h3', '', title));
  if (note) panel.append(el('p', 'panel-note', note));
  return panel;
}

export function openDashboard() {
  renderDashboard();
  $('dashboard-dialog').showModal();
}
