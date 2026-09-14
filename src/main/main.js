import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  desktopCapturer,
  screen,
  globalShortcut,
  nativeImage
} from 'electron';
import path from 'node:path';
import { assetRoot } from './paths.js';
import fs from 'node:fs';
import { Store, Observer, scanQuestHistory } from '../lib/core.js';

import { ocrWorker, recognizeItem, recognizeTasks } from './ocr.js';
import {
  ITEM_HOTKEY,
  configureItemHotkey,
  itemHotkeyRegistered,
  priceOverlay,
  priceOverlayTimer
} from './item-hotkey.js';
import {
  catalogReport,
  customCatalogFile,
  ids,
  loadCatalog,
  loadItemCatalog,
  objectiveIds,
  pendingCatalogs,
  refreshPricesOnLaunch,
  registerCatalog,
  updateItemCatalog,
  validMapIds
} from './catalogs.js';
import { createRequire } from 'node:module';
/* tesseract.js resolves its worker and wasm by package path, which
   needs a resolver rooted at this file. createRequire is the ESM way
   to get one; import.meta.resolve is sync-but-experimental here. */
export const require = createRequire(import.meta.url);
/* One `let` per line, because a module cannot export a name out of the middle
   of a multi-declaration and the scan that decides what to export reads the
   declaration keyword. `let a = null, b = null;` already cost a silent
   ReferenceError once in the renderer, where only the first name got its
   export and the second was left behind for a caller to swallow. */
export let win;
export let store;
export let observer;
export const userData = path.join(app.getPath('appData'), 'TarkovEyes');
const legacyUserData = path.join(app.getPath('appData'), 'RaidNotes');
if (!fs.existsSync(userData) && fs.existsSync(path.join(legacyUserData, 'local-data'))) {
  fs.mkdirSync(userData, { recursive: true });
  fs.cpSync(path.join(legacyUserData, 'local-data'), path.join(userData, 'local-data'), {
    recursive: true
  });
  console.log('Moved the saved profile from ' + legacyUserData + ' to ' + userData);
}
app.setPath('userData', userData);
function validateSender(event) {
  if (event.sender !== win.webContents) throw Error('Unknown caller');
}
function register(name, fn) {
  ipcMain.handle(name, (event, ...args) => {
    validateSender(event);
    return fn(...args);
  });
}
export function validateMode(mode) {
  if (!['pve', 'pvp', 'seasonal'].includes(mode)) throw Error('Invalid profile');
  return mode;
}
function normalizeBackup(doc) {
  const source = doc?.data || doc;
  if (!source || source.version !== 1 || !source.profiles?.pvp || !source.profiles?.pve)
    throw Error('This is not a TarkovEyes backup.');
  source.profiles.seasonal ||= {};
  for (const mode of ['pvp', 'pve', 'seasonal']) {
    const p = (source.profiles[mode] ||= {});
    p.quests ||= {};
    p.objectives ||= {};
    p.objectiveProgress ||= {};
    p.questSources ||= {};
    p.questSync ||= { seenEvents: [], lastEventAt: null, lastScanAt: null, history: [] };
    p.questSync.history ||= [];
    p.raidHidden ||= {};
    p.raidChecklist ||= {};
    p.raidPlans ||= {};
    p.raidHistory = Array.isArray(p.raidHistory) ? p.raidHistory.slice(0, 100) : [];
    p.customMarkers ||= {};
    p.questNotes ||= {};
    p.favorites = Array.isArray(p.favorites) ? p.favorites : [];
  }
  source.mode = ['pvp', 'pve', 'seasonal'].includes(source.mode) ? source.mode : 'pvp';
  return source;
}
async function refreshQuestLogs() {
  const history = await scanQuestHistory(store.data.settings.logs),
    scannedAt = Date.now();
  const unknownQuestIds = [
    ...new Set(history.events.filter(event => !ids.has(event.id)).map(event => event.id))
  ];
  // Ids alone say nothing. The trader that sent the notification and the date it
  // was last seen are what let a player recognise a quest the catalogues lack.
  const unknownQuests = unknownQuestIds.map(id => {
    const seen = history.events.filter(event => event.id === id);
    const latest = seen[seen.length - 1];
    return {
      id,
      trader:
        seen
          .map(event => event.trader)
          .filter(Boolean)
          .pop() || null,
      status: latest?.status || null,
      lastSeen: latest?.observedAt || null,
      firstSeen: seen[0]?.observedAt || null
    };
  });
  const summary = store.applyQuestHistory(history.events, scannedAt);
  return {
    data: store.data,
    summary,
    unknownQuestIds,
    unknownQuests,
    notificationFiles: history.notificationFiles,
    ignoredFiles: history.ignoredFiles,
    scannedAt
  };
}
app.whenReady().then(() => {
  app.setName('TarkovEyes');
  // App-owned directory only. Never store anything under the game folders.
  store = new Store(path.join(app.getPath('userData'), 'local-data'));
  observer = new Observer();
  win = new BrowserWindow({
    /* The window and taskbar icon while the application runs. The packaged
       exe keeps whatever icon it was built with - changing that needs a .ico
       and a repackage - so this is the one a person actually sees. */
    icon: path.join(import.meta.dirname, '..', 'app', 'assets', 'logo.png'),
    width: 1480,
    height: 940,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: '#101517',
    title: 'TarkovEyes',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  );
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  // Renderer traffic is blocked. The main process contacts only json.tarkov.dev when the user explicitly refreshes item prices.
  win.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_d, cb) => cb({ cancel: true })
  );
  register('bootstrap', async () => {
    for (const mode of ['pvp', 'pve', 'seasonal']) loadCatalog(mode);
    let logRefresh = null;
    if (store.data.settings.logs) {
      try {
        logRefresh = await refreshQuestLogs();
      } catch (error) {
        logRefresh = { error: error.message };
      }
    }
    return {
      data: store.data,
      observer: observer.state,
      storageError: store.error,
      desktop: true,
      logRefresh,
      itemHotkey: {
        enabled: !!store.data.settings.itemHotkeyEnabled,
        registered: itemHotkeyRegistered,
        accelerator: ITEM_HOTKEY
      }
    };
  });
  register('pick-folder', async kind => {
    if (!['screenshots', 'logs'].includes(kind)) throw Error('Invalid folder type');
    const result = await dialog.showOpenDialog(win, {
      title: kind === 'screenshots' ? 'Choose Tarkov Screenshots folder' : 'Choose EFT Logs folder',
      properties: ['openDirectory']
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });
  register('settings', async input => {
    for (const key of ['screenshots', 'logs']) {
      if (typeof input[key] !== 'string' || input[key].length > 2000) throw Error('Invalid folder');
      if (input[key]) {
        if (!path.isAbsolute(input[key])) throw Error('Choose an absolute folder path');
        const folder = await fs.promises.realpath(input[key]);
        if (!(await fs.promises.stat(folder)).isDirectory()) throw Error('Choose a folder');
        // Do not allow the observer source to overlap the app-owned storage.
        const dataDir = path.dirname(store.file);
        const rel = path.relative(folder, dataDir);
        if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel)))
          throw Error('Select the game screenshots/logs folder, not an app or drive root');
      }
    }
    store.data.settings = {
      ...store.data.settings,
      screenshots: input.screenshots,
      logs: input.logs,
      autoFollow: !!input.autoFollow
    };
    store.write();
    await observer.start(store.data.settings);
    return store.data.settings;
  });
  register('map-layers', layers => {
    const keys = [
      'extracts',
      'pmcExtractNames',
      'scavs',
      'scavExtractNames',
      'transits',
      'transitNames',
      'containerMedical',
      'containerRations',
      'containerTechnical',
      'containerWeapons',
      'containerValuables',
      'containerCaches',
      'looseValuables',
      'looseBattlepass',
      'looseMedical',
      'looseProvisions',
      'looseTechnical',
      'looseKeys',
      'looseWeapons',
      'looseGear',
      'looseTask',
      'looseOther',
      'labsKeycards',
      'labsKeycardNames',
      'landmarks',
      'customMarkers',
      'lockedDoors',
      'switches',
      'bossSpawns',
      'btrStops',
      'btrRoute',
      'hazardMinefield',
      'hazardSniper',
      'hazardMortar',
      'hazardHazard'
    ];
    if (!layers || keys.some(key => typeof layers[key] !== 'boolean'))
      throw Error('Invalid map layers');
    store.data.settings.mapLayers = Object.fromEntries(keys.map(key => [key, layers[key]]));
    store.write();
    return store.data.settings.mapLayers;
  });
  register('progress', change => {
    validateMode(change.mode);
    if (change.type === 'quest') {
      if (
        !ids.has(change.id) ||
        !['untracked', 'active', 'failed', 'completed'].includes(change.value)
      )
        throw Error('Invalid quest');
      store.data.profiles[change.mode].quests[change.id] = change.value;
      if (change.value === 'untracked')
        delete store.data.profiles[change.mode].questSources[change.id];
      else store.data.profiles[change.mode].questSources[change.id] = 'manual';
    } else if (change.type === 'objective') {
      if (!objectiveIds.has(change.id) || typeof change.value !== 'boolean')
        throw Error('Invalid objective');
      store.data.profiles[change.mode].objectives[change.id] = change.value;
    } else if (change.type === 'objective-counter') {
      if (
        !objectiveIds.has(change.id) ||
        !Number.isInteger(change.value) ||
        !Number.isInteger(change.target) ||
        change.value < 0 ||
        change.target < 1 ||
        change.value > change.target ||
        change.target > 9999 ||
        typeof change.confirmed !== 'boolean'
      )
        throw Error('Invalid objective counter');
      store.data.profiles[change.mode].objectiveProgress[change.id] = {
        value: change.value,
        target: change.target,
        confirmed: change.confirmed,
        source: change.source === 'ocr' ? 'ocr' : 'manual',
        updatedAt: Date.now()
      };
      store.data.profiles[change.mode].objectives[change.id] =
        change.confirmed && change.value >= change.target;
    } else throw Error('Invalid progress');
    store.write();
    return true;
  });
  register('raid-preferences', input => {
    const mode = validateMode(input?.mode),
      map = String(input?.map || '');
    if (!validMapIds.has(map)) throw Error('Invalid map');
    if (
      !Array.isArray(input.hidden) ||
      input.hidden.length > 200 ||
      input.hidden.some(id => typeof id !== 'string' || !ids.has(id))
    )
      throw Error('Invalid hidden quests');
    const profile = store.data.profiles[mode];
    profile.raidHidden[map] = [...new Set(input.hidden)];
    store.write();
    return true;
  });
  register('quest-meta', input => {
    const mode = validateMode(input?.mode),
      id = String(input?.id || ''),
      hasNote = typeof input?.note === 'string',
      hasFavorite = typeof input?.favorite === 'boolean',
      hasHidden = typeof input?.hidden === 'boolean';
    if (
      !ids.has(id) ||
      (!hasNote && !hasFavorite && !hasHidden) ||
      (hasNote && input.note.length > 2000)
    )
      throw Error('Invalid quest metadata');
    const p = store.data.profiles[mode];
    if (hasNote) {
      if (input.note.trim()) p.questNotes[id] = input.note.trim();
      else delete p.questNotes[id];
    }
    if (hasFavorite) {
      const favorites = new Set(p.favorites);
      if (input.favorite) favorites.add(id);
      else favorites.delete(id);
      p.favorites = [...favorites];
    }
    if (hasHidden) {
      const hiddenQuests = new Set(p.hiddenQuests);
      if (input.hidden) hiddenQuests.add(id);
      else hiddenQuests.delete(id);
      p.hiddenQuests = [...hiddenQuests];
    }
    store.write();
    return true;
  });
  register('custom-markers', input => {
    const mode = validateMode(input?.mode),
      map = String(input?.map || '');
    if (!validMapIds.has(map) || !Array.isArray(input.markers) || input.markers.length > 200)
      throw Error('Invalid custom markers');
    for (const marker of input.markers) {
      if (
        typeof marker.id !== 'string' ||
        marker.id.length > 80 ||
        typeof marker.name !== 'string' ||
        !marker.name.trim() ||
        marker.name.length > 80 ||
        typeof marker.note !== 'string' ||
        marker.note.length > 500 ||
        ![marker.position?.x, marker.position?.y, marker.position?.z].every(Number.isFinite)
      )
        throw Error('Invalid custom marker');
    }
    store.data.profiles[mode].customMarkers[map] = input.markers;
    store.write();
    return true;
  });
  register('raid-event', input => {
    const mode = validateMode(input?.mode);
    if (
      !['start', 'end', 'outcome'].includes(input?.type) ||
      (input.map && !validMapIds.has(input.map)) ||
      (input.type === 'outcome' && typeof input.id !== 'string')
    )
      throw Error('Invalid raid event');
    return store.recordRaidEvent(mode, input);
  });
  register('scan-task-screenshot', recognizeTasks);
  register('scan-item-screenshot', recognizeItem);
  register('load-items', mode => loadItemCatalog(mode));
  register('refresh-item-prices', updateItemCatalog);
  register('item-hotkey-settings', enabled => {
    if (typeof enabled !== 'boolean') throw Error('Invalid item shortcut setting');
    store.data.settings.itemHotkeyEnabled = enabled;
    store.write();
    return configureItemHotkey();
  });
  register('item-value-settings', value => {
    if (!Number.isFinite(value) || value < 0 || value > 1000000)
      throw Error('Invalid item value threshold');
    store.data.settings.itemValueThreshold = Math.round(value);
    store.write();
    return store.data.settings.itemValueThreshold;
  });
  register('export-backup', async () => {
    const result = await dialog.showSaveDialog(win, {
      title: 'Export TarkovEyes backup',
      defaultPath: 'TarkovEyes-backup-' + new Date().toISOString().slice(0, 10) + '.json',
      filters: [{ name: 'TarkovEyes backup', extensions: ['json'] }]
    });
    if (result.canceled) return null;
    await fs.promises.writeFile(
      result.filePath,
      JSON.stringify(
        {
          format: 'tarkoveyes-backup',
          exportedAt: new Date().toISOString(),
          appVersion: app.getVersion(),
          data: store.data
        },
        null,
        2
      )
    );
    return result.filePath;
  });
  register('import-backup', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Import TarkovEyes backup',
      properties: ['openFile'],
      filters: [{ name: 'TarkovEyes backup', extensions: ['json'] }]
    });
    if (result.canceled) return null;
    const raw = await fs.promises.readFile(result.filePaths[0], 'utf8');
    if (raw.length > 30 * 1024 * 1024) throw Error('The backup is too large.');
    const next = normalizeBackup(JSON.parse(raw));
    if (fs.existsSync(store.file))
      fs.copyFileSync(store.file, store.file + '.before-import-' + Date.now());
    store.data = next;
    store.write();
    return store.data;
  });
  register('load-catalog', mode => loadCatalog(mode));
  register('import-catalog', async mode => {
    validateMode(mode);
    const result = await dialog.showOpenDialog(win, {
      title: 'Import TarkovEyes quest data',
      properties: ['openFile'],
      filters: [{ name: 'Quest catalog', extensions: ['json'] }]
    });
    if (result.canceled) return null;
    const raw = await fs.promises.readFile(result.filePaths[0], 'utf8');
    if (raw.length > 50 * 1024 * 1024) throw Error('The catalog is too large.');
    const doc = JSON.parse(raw),
      integrity = catalogReport(doc),
      target = customCatalogFile(mode),
      tmp = target + '.tmp';
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(tmp, JSON.stringify(doc));
    await fs.promises.rename(tmp, target);
    registerCatalog(doc);
    return { ...doc, integrity, localOverride: true };
  });
  register('inspect-catalog', async mode => {
    validateMode(mode);
    const result = await dialog.showOpenDialog(win, {
      title: 'Preview TarkovEyes quest data update',
      properties: ['openFile'],
      filters: [{ name: 'Quest catalog', extensions: ['json'] }]
    });
    if (result.canceled) return null;
    const raw = await fs.promises.readFile(result.filePaths[0], 'utf8');
    if (raw.length > 50 * 1024 * 1024) throw Error('The catalog is too large.');
    const doc = JSON.parse(raw),
      integrity = catalogReport(doc),
      token = crypto.randomUUID();
    pendingCatalogs.set(token, { mode, doc });
    setTimeout(() => pendingCatalogs.delete(token), 10 * 60 * 1000).unref?.();
    return { token, integrity, generatedAt: doc.generatedAt || null };
  });
  register('apply-catalog', async input => {
    const pending = pendingCatalogs.get(input?.token);
    if (!pending || pending.mode !== input?.mode)
      throw Error('The catalog preview expired. Choose the file again.');
    const target = customCatalogFile(pending.mode),
      tmp = target + '.tmp';
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(tmp, JSON.stringify(pending.doc));
    await fs.promises.rename(tmp, target);
    registerCatalog(pending.doc);
    pendingCatalogs.delete(input.token);
    return loadCatalog(pending.mode);
  });
  register('mode', mode => {
    validateMode(mode);
    store.data.mode = mode;
    store.write();
    return true;
  });
  register('refresh-logs', refreshQuestLogs);
  register('open-data', () => shell.openPath(path.dirname(store.file)));
  /* The renderer cannot follow a link: navigation and new windows are denied,
     and its CSP is default-src 'self'. So a wiki page opens in the real
     browser, through here - and only ever a wiki page. The URL is rebuilt from
     a parse rather than pattern-matched, because openExternal hands whatever it
     is given to the operating system, and a renderer that has been tampered
     with must not be able to reach anything else through this. */
  register('open-wiki', link => {
    let url;
    try {
      url = new URL(String(link));
    } catch {
      throw new Error('not a URL');
    }
    if (url.protocol !== 'https:') throw new Error('not https');
    if (url.hostname !== 'escapefromtarkov.fandom.com') throw new Error('not the wiki');
    if (!url.pathname.startsWith('/wiki/')) throw new Error('not a wiki page');
    shell.openExternal('https://escapefromtarkov.fandom.com' + url.pathname);
    return true;
  });
  observer.on('state', state => {
    if (!win.isDestroyed()) win.webContents.send('observer', state);
  });
  observer.on('quest', event => {
    const mode = ['pvp', 'pve', 'seasonal'].includes(event.mode) ? event.mode : store.data.mode;
    if (store.applyQuestEvent(mode, event) && !win.isDestroyed())
      win.webContents.send('quest-progress', {
        ...event,
        mode,
        source: 'logs',
        catalogKnown: ids.has(event.id)
      });
  });
  configureItemHotkey();
  win.loadFile(path.join(assetRoot, 'index.html'));
  win.on('closed', () => {
    clearTimeout(priceOverlayTimer);
    if (priceOverlay && !priceOverlay.isDestroyed()) priceOverlay.destroy();
    app.quit();
  });
  observer.start(store.data.settings).catch(() => {});
  /* After the window, never before it: a launch must not wait on a network
     call, and this one is allowed to take as long as it likes or fail. */
  setTimeout(() => {
    refreshPricesOnLaunch();
  }, 1500);
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', async () => {
  observer?.stop();
  clearTimeout(priceOverlayTimer);
  try {
    await ocrWorker?.terminate();
  } catch {}
  app.quit();
});
