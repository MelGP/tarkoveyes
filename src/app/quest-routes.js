/*
 * quest-routes, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { quests } from './state.js';

import { renderList } from './quest-list.js';
import { $, toast } from './dom.js';
import { profile, requirementId } from './quest-state.js';

export function pathToSeeds(seedIds) {
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

export function collectorPath() {
  const tagged = quests.filter(q => q.kappaRequired);
  return tagged.length
    ? new Set(tagged.map(q => q.id))
    : pathToSeeds(quests.filter(q => q.name === 'Collector').map(q => q.id));
}

export function lightkeeperPath() {
  return pathToSeeds(
    quests
      .filter(
        q => q.lightkeeperRequired || q.traderName === 'Lightkeeper' || /lightkeeper/i.test(q.name)
      )
      .map(q => q.id)
  );
}

export function questPathSet(value) {
  if (value === 'collector') return collectorPath();
  if (value === 'lightkeeper') return lightkeeperPath();
  if (value === 'story') return new Set(quests.filter(q => q.category === 'story').map(q => q.id));
  if (value === 'favorites') return new Set(profile().favorites || []);
  return new Set(quests.map(q => q.id));
}

export function updateQuestPathOptions() {
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

export function applyQuestPathFilter() {
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
