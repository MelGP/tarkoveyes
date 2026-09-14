/*
 * keys, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { keyCatalog, quests } from './state.js';

import { el, uiIcon } from './dom.js';
import { status } from './quest-state.js';

export function keyImage(id) {
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

export function keyIdsForName(name) {
  return Object.entries(keyCatalog)
    .filter(([, key]) => name.toLowerCase().includes(key.name.toLowerCase()))
    .map(([id]) => id);
}

export function keyIconFor(name) {
  const ids = keyIdsForName(name);
  return ids.length === 1 ? keyImage(ids[0]) : uiIcon('keycard');
}

export function keyName(id) {
  return keyCatalog[id]?.name || 'Unknown key';
}

export function questsNeedingKey(id) {
  return quests
    .filter(q => (q.neededKeys || []).some(key => key.id === id) && status(q) !== 'completed')
    .map(q => q.name);
}
