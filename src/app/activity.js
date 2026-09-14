/*
 * activity, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import {
  activityUnread,
  allData,
  assignActivityUnread,
  data,
  observer,
  quests,
  traderCatalog,
  unknownQuestDetails
} from './state.js';

import { $, el } from './dom.js';
import { mapName, profile } from './quest-state.js';

export function updateActivityBadge() {
  const badge = $('activity-count');
  badge.textContent = activityUnread;
  badge.hidden = !activityUnread;
}

export function renderActivity() {
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

export function openActivity() {
  assignActivityUnread(0);
  updateActivityBadge();
  renderActivity();
  $('activity-dialog').showModal();
}

export function questEventMessage(q, statusValue) {
  const label = q?.name || 'Quest';
  if (statusValue === 'completed') return 'Quest completed: ' + label;
  if (statusValue === 'failed') return 'Quest failed: ' + label;
  return 'New active quest: ' + label;
}

export function renderLogDiagnostics() {
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
