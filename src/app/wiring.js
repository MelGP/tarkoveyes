/*
 * wiring, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { renderDetail } from './quest-brief.js';
import { renderDoors, renderKeycardDoors, renderSwitches } from './doors.js';
import { applyFloor } from './floors.js';

import { renderHazards } from './hazards.js';
import { closeMarkerEditor, renderCustomMarkers, saveMarkerEditor } from './custom-markers.js';
import { openDashboard } from './dashboard.js';
import { renderList, scheduleListRender } from './quest-list.js';
import { applyQuestPathFilter } from './quest-routes.js';
import { focusQuest, setDetailsCollapsed, setMapFocus } from './view.js';
import { renderMyRaid, showActiveQuests } from './my-raid.js';
import { mapName, objectivePoints, setHideDone, source, status } from './quest-state.js';
import { runTaskScan } from './scan.js';
import { adoptObservedSession, switchMap } from './map-load.js';
import { $, toast } from './dom.js';
import {
  openActivity,
  questEventMessage,
  renderActivity,
  updateActivityBadge
} from './activity.js';
import { renderBosses } from './bosses.js';
import { renderBtr } from './btr.js';
import {
  openCommandPalette,
  renderCommandResults,
  runCommand,
  updateCommandSelection
} from './command-palette.js';
import {
  itemCatalogStatus,
  loadItemsView,
  openItems,
  refreshItemPrices,
  renderItemResults,
  runItemScan,
  searchItems,
  updateItemHotkey
} from './items-view.js';
import { renderLandmarks } from './landmarks.js';
import { renderLoot } from './loot.js';
import {
  applyLayerPreset,
  renderExtractLabels,
  saveLayers,
  updateLayerChildren
} from './map-layers.js';
import { updateAge, updatePosition } from './player.js';
import { renderMarkers } from './markers.js';

import {
  changeProgress,
  connection,
  loadMode,
  looseLayers,
  price,
  railLayout,
  selectQuest
} from './app.js';
import {
  activityUnread,
  allData,
  assignActivityUnread,
  assignAllData,
  assignCommandIndex,
  assignConfirmedFix,
  assignData,
  assignLastFixTime,
  assignLastRaidState,
  assignObserver,
  assignUnknownQuestDetails,
  bridge,
  commandIndex,
  commandMatches,
  currentMapId,
  data,
  detailsCollapsed,
  itemHotkeyState,
  itemScanRunning,
  lastItemResults,
  lastItemResultsScanned,
  lastRaidState,
  lootData,
  mapDefinitions,
  mapFocus,
  myRaidOpen,
  observer,
  ocrQuests,
  ocrSelection,
  quests,
  selected
} from './state.js';
import { containerLayers, hazardKinds, modeLabel } from './vocabulary.js';

/* As a classic script every name in this file was global, and the two console
 * harnesses in tools/dev just said `quests` or `status(q)`. As a module they
 * are module-scoped, so the ones those harnesses actually reach for are
 * published here deliberately - a small, named test surface rather than 281
 * accidental globals.
 *
 * Getters, not assignments. quests, selected, mapFocus and detailsCollapsed
 * are reassigned while the app runs, and `window.quests = quests` would pin
 * whatever they held at load - an empty array, in the case that matters.
 */
/* Everything the controls do, wired once at the end of start().
 *
 * Hoisted out of start(), which had grown to 956 lines. `boot` is passed in
 * because the last thing this does is report a storage error the bootstrap
 * came back with - the only value it needs from the boot sequence. */
export function wireControls(boot) {
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
      assignCommandIndex(Math.min(commandMatches.length - 1, commandIndex + 1));
      updateCommandSelection();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      assignCommandIndex(Math.max(0, commandIndex - 1));
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
  /* Typing fires once per character and rebuilding the list is the expensive
     part - 21ms with every quest shown - so the search waits for a pause while
     the four selects, which change once per use, still redraw immediately. */
  $('quest-search').addEventListener('input', scheduleListRender);
  for (const id of ['map-filter', 'trader', 'status-filter'])
    $(id).addEventListener('change', renderList);
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
  for (const id of ['layer-btr', 'layer-btr-route'])
    $(id).onchange = () => {
      renderBtr();
      updateLayerChildren();
      saveLayers();
    };
  const hideDone = $('layer-hide-done');
  if (hideDone) hideDone.onchange = () => setHideDone(hideDone.checked);
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
      toast('Could not load that bundled map.', 'error');
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
      toast('Switched to ' + modeLabel(next) + ' progress.');
    } catch {
      toast('Could not switch profiles.', 'error');
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
  $('close-chain').onclick = () => $('chain-dialog').close();
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
      toast('Could not change the inventory shortcut.', 'error');
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
      toast('Could not save the loot threshold.', 'error');
    }
  };
  $('dashboard-button').onclick = openDashboard;
  $('close-dashboard').onclick = () => $('dashboard-dialog').close();
  $('scan-tasks').onclick = runTaskScan;
  $('rescan-tasks').onclick = runTaskScan;
  $('close-scan').onclick = () => $('scan-dialog').close();
  $('apply-scan').onclick = async () => {
    const chosen = ocrSelection.filter(item => item.element.checked),
      newQuests = ocrQuests.filter(item => item.element.checked);
    if (!chosen.length && !newQuests.length) {
      toast('Nothing is ticked to apply.');
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
      /* The Tasks screen only lists tasks you are on, so a quest this scan
         just recorded progress for is one you have taken - and leaving it
         `untracked` kept it off the map anyway, which is most of the reason
         the map looked empty for quests the game says are half done. Only
         untracked is promoted: a completed or failed record is a stronger
         statement than a reading of a screenshot and is left alone. */
      const started = [];
      /* Both routes to the same place: a quest the reviewer ticked outright,
         and a quest whose objectives were ticked, which means you are on it. */
      const wanted = new Set([
        ...newQuests.map(item => item.id),
        ...chosen.map(item => item.questId)
      ]);
      for (const id of wanted) {
        const q = quests.find(item => item.id === id);
        if (!q || status(q) !== 'untracked') continue;
        await changeProgress({ type: 'quest', id, value: 'active' });
        started.push(q.name);
      }
      $('scan-dialog').close();
      if (selected) renderDetail();
      renderList();
      renderMarkers();
      const said = [];
      if (started.length)
        said.push(started.length + ' quest' + (started.length === 1 ? '' : 's') + ' marked active');
      if (chosen.length)
        said.push(chosen.length + ' objective update' + (chosen.length === 1 ? '' : 's'));
      toast(said.join(' · ') + '. They are on the map now.');
    } catch (e) {
      toast('Could not apply the scan: ' + e.message, 'error');
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
      assignUnknownQuestDetails(result.unknownQuests || []);
      assignData(result.data);
      await loadMode();
      updatePosition();
      const current = result.summary[data.mode] || { active: 0, changed: 0 };
      assignActivityUnread(activityUnread + current.changed || 0);
      updateActivityBadge();
      if ($('activity-dialog').open) renderActivity();
      toast('Logs updated · ' + current.active + ' active ' + modeLabel(data.mode) + ' quests.');
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
          assignAllData(await bridge.applyCatalog({ mode: data.mode, token: preview.token }));
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
      toast('Could not export the backup: ' + e.message, 'error');
    }
  };
  $('import-backup').onclick = async () => {
    try {
      const imported = await bridge.importBackup();
      if (imported) {
        assignData(imported);
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
      assignConfirmedFix(null);
      assignLastFixTime(0);
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
  assignLastRaidState(observer.raid || 'unknown');
  bridge.onObserver(state => {
    const fresh = state.position && state.position.observedAt !== observer.position?.observedAt,
      previousRaid = lastRaidState;
    assignObserver(state);
    assignLastRaidState(state.raid || 'unknown');
    if (previousRaid !== lastRaidState && lastRaidState === 'started') {
      const observedMode = ['pvp', 'pve', 'seasonal'].includes(state.mode) ? state.mode : data.mode,
        observedMap = state.map || state.position?.map || currentMapId;
      adoptObservedSession(observedMode, observedMap);
      bridge
        .raidEvent({
          mode: observedMode,
          type: 'start',
          map: observedMap,
          /* the log line knows when this happened; Date.now() only knows when
             the application got round to reading it */
          at: state.raidAt || Date.now(),
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
        .raidEvent({
          mode: observedMode,
          type: 'end',
          at: state.raidAt || Date.now(),
          outcome: 'unknown'
        })
        .then(raid => {
          if (!raid) return;
          const index = data.profiles[observedMode].raidHistory.findIndex(
            item => item.id === raid.id
          );
          if (index >= 0) data.profiles[observedMode].raidHistory[index] = raid;
          toast('Raid recorded in ' + modeLabel(observedMode) + ' history.');
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
      assignActivityUnread(activityUnread + 1);
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
  /* A <select> keeps focus after you pick from it, and a focused select eats
     single-letter shortcuts - it spends them on type-ahead, so F in the map
     picker jumps to Factory instead of focusing the map. Picking a map is the
     first thing anyone does here, which left F looking broken from then on.

     Focus goes back to the document after a change the pointer started. A
     keyboard user keeps it, because they are still navigating the control and
     taking focus away mid-arrow would be far worse than a dead shortcut. */
  let selectReachedByPointer = null;
  document.addEventListener(
    'pointerdown',
    event => {
      selectReachedByPointer =
        event.target instanceof Element ? event.target.closest('select') : null;
    },
    true
  );
  document.addEventListener(
    'change',
    event => {
      if (event.target instanceof HTMLSelectElement && event.target === selectReachedByPointer) {
        event.target.blur();
        selectReachedByPointer = null;
      }
    },
    true
  );

  document.addEventListener('keydown', e => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName),
      dialogOpen = !!document.querySelector('dialog[open]');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette();
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !typing && !dialogOpen) {
      /* The rail shows eight quests at a time and selecting one is now the
         main thing you do on this screen, so it is worth a key. Nothing else
         binds the arrows outside the command palette, and that counts as
         typing. */
      const rows = [...$('quest-list').querySelectorAll('.quest-row')];
      if (!rows.length) return;
      e.preventDefault();
      const at = rows.findIndex(row => row.classList.contains('selected'));
      const next =
        e.key === 'ArrowDown'
          ? Math.min(rows.length - 1, at + 1)
          : Math.max(0, (at === -1 ? rows.length : at) - 1);
      rows[next].click();
      /* Selecting re-renders the list, so the row that was clicked is gone by
         the time it needs scrolling into view. */
      requestAnimationFrame(() => {
        const now = $('quest-list').querySelector('.quest-row.selected');
        if (!now) return;
        /* Selection moved but focus did not, so Tab carried on from the top of
           the page and a screen reader was told nothing had happened. The row
           is a button carrying the quest name and `aria-pressed`, so putting
           focus on it says the right thing. Scroll it deliberately rather than
           letting focus do it, which jumps. */
        now.focus({ preventScroll: true });
        now.scrollIntoView({ block: 'nearest' });
      });
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
      /* A ladder, most transient first, one rung per press. Escape used to
         leave map focus before closing a popup, so a popup opened while
         focused took two presses and threw away the focus to get rid of one
         card. The brief joined the ladder when it became a floating card:
         before that it was a column you toggled, and a column you are not
         looking at costs nothing, but a card lying over the map does. */
      const drawer = document.querySelector('.layer-disclosure[open]');
      const popup = $('map-popup');
      if (!popup.hidden) popup.hidden = true;
      else if (drawer) drawer.open = false;
      else if (railLayout.matches && !detailsCollapsed) setDetailsCollapsed(true);
      else if (mapFocus) setMapFocus(false);
    }
  });
  if (boot.storageError) toast(boot.storageError, 'error');
  else if (boot.logRefresh?.error)
    toast('Automatic log update failed: ' + boot.logRefresh.error, 'error');
  else if (boot.logRefresh?.summary?.[data.mode]?.changed) {
    assignActivityUnread(boot.logRefresh.summary[data.mode].changed);
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
