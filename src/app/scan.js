/*
 * scan, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import {
  assignOcrQuests,
  assignOcrSelection,
  bridge,
  data,
  ocrQuests,
  ocrSelection,
  quests,
  selected
} from './state.js';

import { $, el, toast } from './dom.js';
import { status } from './quest-state.js';

export function renderScanResults(result) {
  assignOcrSelection([]);
  assignOcrQuests([]);
  $('scan-results').replaceChildren();
  $('ocr-preview').textContent = result.textPreview || '';
  const matches = result.matches || [];
  $('scan-summary').textContent = matches.length
    ? matches.length +
      ' quest' +
      (matches.length === 1 ? '' : 's') +
      ' found' +
      /* Two screens are worth scanning and they carry different things. The
         Tasks table is names, locations, statuses and progress bars and has no
         objective text at all; a single quest opened shows every objective and
         a tick against the ones you have done. Say which one arrived, once,
         rather than on every card. */
      (matches.some(m => m.objectives.length)
        ? ' with ' +
          matches.reduce((n, m) => n + m.objectives.length, 0) +
          ' objective' +
          (matches.reduce((n, m) => n + m.objectives.length, 0) === 1 ? '' : 's') +
          ' · review before applying.'
        : ' · this screen lists quests, not objective progress. Open a single quest to import its objectives.')
    : 'No quest names were read. The Tasks list and a single opened quest both work; a clearer or larger capture helps.';
  for (const match of matches) {
    const card = el('div', 'scan-card');
    const known = status(quests.find(q => q.id === match.questId) || {});
    card.append(
      el('strong', '', match.questName),
      el(
        'small',
        '',
        Math.round(match.confidence * 100) +
          '% name match' +
          (match.percent === null || match.percent === undefined
            ? ''
            : ' · the row reads ' + match.percent + '%')
      )
    );
    /* The Tasks screen is a table of names, locations, statuses and progress
       bars - it carries no objective text at all. So the only thing this
       dialog could ever apply was absent from the one screen it exists for,
       and the Apply button was disabled every single time. The quest itself
       is the thing to import: the row says it is active, and that is what
       the application does not know about 245 of them. */
    if (match.rowActive && known === 'untracked') {
      const label = el('label', 'scan-objective scan-quest'),
        check = el('input');
      check.type = 'checkbox';
      check.checked = true;
      check.dataset.scanQuest = match.questId;
      const body = el('span');
      body.append(
        el('span', '', 'Mark this quest Active'),
        el('small', '', 'The app has no record of it. The row on screen says active.')
      );
      label.append(check, body);
      card.append(label);
      ocrQuests.push({ id: match.questId, name: match.questName, element: check });
    } else if (match.rowActive && known !== 'untracked') {
      card.append(el('small', 'scan-known', 'Already recorded as ' + known + ' - left alone.'));
    }

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
  $('apply-scan').disabled = !ocrSelection.length && !ocrQuests.length;
}

export async function runTaskScan() {
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
