/*
 * chain, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { dashboardPanel, mapWorkload, questChainLayers, readyToStart } from './dashboard.js';
import { showActiveQuests } from './my-raid.js';

import { selectQuest } from './app.js';
import { $, el } from './dom.js';
import { availableBecause, mapName, questMaps, status } from './quest-state.js';
import { switchMap } from './map-load.js';

export function chainColumn(heading, entries, extra = '', current = null) {
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

export function renderChain(quest) {
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

export function renderNextSteps(content) {
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
    /* "have every prerequisite completed" was true when this only listed
       quests that had prerequisites. Most of them now have none at all, and
       claiming a proof for those would be inventing one - so say which is
       which. */
    ready.length +
      ' quest' +
      (ready.length === 1 ? '' : 's') +
      ' nothing recorded is holding back' +
      (() => {
        const proven = ready.filter(q => availableBecause(q) === 'prerequisites').length;
        const free = ready.length - proven;
        if (!proven || !free) return '';
        return (
          ': ' + proven + ' with every prerequisite done, ' + free + ' waiting on no other quest'
        );
      })() +
      '.'
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
