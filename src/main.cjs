const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  desktopCapturer,
  screen,
  globalShortcut,
  nativeImage
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Store, Observer, scanQuestHistory, parseTaskOcr } = require('./core.cjs');
const { liftText: liftTextPixels } = require('./imaging.cjs');
const { signatureOf, signatureFrom, resemblance } = require('./appearance.cjs');

const {
  cell: templateCell,
  slotSize,
  gridPhases,
  tileOrigin,
  sampleTile,
  TemplateStore
} = require('./templates.cjs');
const {
  modeSlugs,
  normalizeItemPayload,
  validateItemCatalog,
  matchItemText,
  matchItemLines
} = require('./items.cjs');
let win, store, observer, ocrWorker, ocrWorkerPromise, priceOverlay, priceOverlayTimer;
let lastOcrProgress = '';
let itemHotkeyRunning = false,
  itemHotkeyRegistered = false;
let ocrContext = null,
  ocrQueue = Promise.resolve();
const ITEM_HOTKEY = 'Shift+F8';
const pendingCatalogs = new Map();
const assetRoot = path.join(__dirname, 'app');
const questData = JSON.parse(fs.readFileSync(path.join(assetRoot, 'data/quests.json')));
const pveData = JSON.parse(fs.readFileSync(path.join(assetRoot, 'data/quests-pve.json')));
const seasonalData = JSON.parse(fs.readFileSync(path.join(assetRoot, 'data/quests-seasonal.json')));
const specialData = JSON.parse(fs.readFileSync(path.join(assetRoot, 'data/special-tracks.json')));
const mapData = JSON.parse(fs.readFileSync(path.join(assetRoot, 'data/maps.json')));
const validMapIds = new Set(mapData.map(map => map.id));
const ids = new Set(
  [...questData.quests, ...pveData.quests, ...seasonalData.quests, ...specialData.quests].flatMap(
    q => [q.id, ...(q.sourceQuestIds || [])]
  )
);
const objectiveIds = new Set(
  [...questData.quests, ...pveData.quests, ...seasonalData.quests, ...specialData.quests].flatMap(
    q => q.objectives.map(o => o.id)
  )
);
app.setName('TarkovEyes');

/* The save used to live under %APPDATA%\RaidNotes, from before the rename, and
 * it holds the only copy of the real profile - every completed quest, every
 * recorded raid. Pointing at the new folder without moving the old one would
 * orphan the lot, which is why this was left alone for so long.
 *
 * So it moves rather than being repointed, and the rules are:
 *   - only when the new folder does not exist, so a second launch never
 *     overwrites live data with a stale copy;
 *   - copy, never move, so the old folder survives as a way back;
 *   - only local-data, which is ours. Everything else under userData is
 *     Chromium's cache and is rebuilt on demand; copying 5 MB of GPU caches
 *     into a fresh profile would import staleness, not history;
 *   - failure is fatal and loud. A silent failure here starts you on an empty
 *     profile with your real one still on disk, and that reads as data loss.
 */
const userData = path.join(app.getPath('appData'), 'TarkovEyes');
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
function validateMode(mode) {
  if (!['pve', 'pvp', 'seasonal'].includes(mode)) throw Error('Invalid profile');
  return mode;
}
function catalogReport(doc) {
  const questIds = new Set(),
    objectiveIdsFound = new Set(),
    names = new Map();
  let mapPoints = 0,
    unmappedObjectives = 0,
    objectives = 0,
    sharedObjectiveIds = 0;
  if (!doc || !Array.isArray(doc.quests) || !doc.quests.length || doc.quests.length > 2000)
    throw Error('The file is not a supported quest catalog.');
  for (const quest of doc.quests) {
    if (
      typeof quest.id !== 'string' ||
      quest.id.length < 4 ||
      quest.id.length > 100 ||
      typeof quest.name !== 'string' ||
      !quest.name.trim() ||
      !Array.isArray(quest.mapIds) ||
      !Array.isArray(quest.objectives)
    )
      throw Error('The quest catalog contains an invalid quest.');
    if (questIds.has(quest.id)) throw Error('The quest catalog contains a duplicate quest ID.');
    questIds.add(quest.id);
    if (quest.mapIds.some(id => !validMapIds.has(id)))
      throw Error('The quest catalog contains an unsupported map.');
    names.set(quest.name, (names.get(quest.name) || 0) + 1);
    const questObjectiveIds = new Set();
    for (const objective of quest.objectives) {
      if (
        !objective ||
        typeof objective.id !== 'string' ||
        !objective.id ||
        typeof objective.description !== 'string'
      )
        throw Error('The quest catalog contains an invalid objective.');
      if (questObjectiveIds.has(objective.id))
        throw Error('A quest contains a duplicate objective ID.');
      questObjectiveIds.add(objective.id);
      objectives++;
      if (objectiveIdsFound.has(objective.id)) sharedObjectiveIds++;
      objectiveIdsFound.add(objective.id);
      const points = [...(objective.zones || []), ...(objective.possibleLocations || [])];
      if (!points.length) unmappedObjectives++;
      for (const zone of points) {
        if (zone.mapId && !validMapIds.has(zone.mapId))
          throw Error('A quest point uses an unsupported map.');
        const positions = zone.positions || [zone.position].filter(Boolean);
        mapPoints += positions.length;
        if (positions.some(p => ![p?.x, p?.y, p?.z].every(Number.isFinite)))
          throw Error('The quest catalog contains invalid map coordinates.');
      }
    }
  }
  return {
    quests: doc.quests.length,
    objectives,
    mapPoints,
    unmappedObjectives,
    duplicateQuestIds: 0,
    sharedObjectiveIds,
    duplicateNames: [...names.values()].filter(count => count > 1).length
  };
}
function registerCatalog(doc) {
  for (const quest of doc.quests) {
    ids.add(quest.id);
    for (const objective of quest.objectives) objectiveIds.add(objective.id);
  }
}
function customCatalogFile(mode) {
  return path.join(path.dirname(store.file), 'quest-catalog-' + mode + '.json');
}
function loadCatalog(mode) {
  validateMode(mode);
  const file = customCatalogFile(mode);
  let doc = mode === 'pve' ? pveData : mode === 'seasonal' ? seasonalData : questData,
    localOverride = false;
  if (fs.existsSync(file)) {
    try {
      const custom = JSON.parse(fs.readFileSync(file, 'utf8'));
      catalogReport(custom);
      doc = custom;
      localOverride = true;
    } catch {}
  }
  const integrity = catalogReport(doc);
  registerCatalog(doc);
  return { ...doc, integrity, localOverride };
}
function itemCatalogFile(mode) {
  return path.join(path.dirname(store.file), 'items-' + mode + '.json');
}
function bundledItemCatalogFile(mode) {
  return path.join(assetRoot, 'data', 'items-' + mode + '.json');
}
const itemCatalogs = new Map();
function loadItemCatalog(mode) {
  validateMode(mode);
  for (const file of [itemCatalogFile(mode), bundledItemCatalogFile(mode)]) {
    let stamp;
    try {
      const stat = fs.statSync(file);
      stamp = file + ':' + stat.mtimeMs + ':' + stat.size;
    } catch {
      continue;
    }
    // The parsed catalog is reused until the file itself changes: the matcher
    // derives an index from it, and rebuilding that per scan is what made the
    // item hotkey feel like it had hung.
    const cached = itemCatalogs.get(mode);
    if (cached?.stamp === stamp) return cached.catalog;
    try {
      const catalog = validateItemCatalog(JSON.parse(fs.readFileSync(file, 'utf8')));
      itemCatalogs.set(mode, { stamp, catalog });
      return catalog;
    } catch {}
  }
  throw Error('The item price catalog is unavailable.');
}
async function fetchItemJson(pathname) {
  const response = await fetch('https://json.tarkov.dev/' + pathname, {
    headers: { accept: 'application/json', 'user-agent': 'TarkovEyes item price updater' },
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw Error('tarkov.dev returned HTTP ' + response.status);
  const text = await response.text();
  if (text.length > 100 * 1024 * 1024) throw Error('The price response is too large.');
  return JSON.parse(text);
}
async function updateItemCatalog(mode) {
  validateMode(mode);
  const slug = modeSlugs[mode],
    [items, english, traders, traderEnglish] = await Promise.all([
      fetchItemJson(slug + '/items'),
      fetchItemJson(slug + '/items_en'),
      fetchItemJson(slug + '/traders'),
      fetchItemJson(slug + '/traders_en')
    ]),
    catalog = normalizeItemPayload(items, english, traders, traderEnglish, mode),
    target = itemCatalogFile(mode),
    tmp = target + '.tmp';
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(tmp, JSON.stringify(catalog));
  await fs.promises.rename(tmp, target);
  itemCatalogs.delete(mode);
  return catalog;
}
/* Prices on launch.
 *
 * Until now this application reached the network only when a person pressed
 * Update prices, and the About panel said so in as many words. The user asked
 * for it to happen on open instead, so it does - and the About panel had to
 * be corrected in the same change, because a program that describes its own
 * network behaviour wrongly is worse than one that never described it.
 *
 * Three things keep it well-mannered:
 *
 * - **It never delays the window.** It is scheduled after the window is
 *   loading and awaited by nothing.
 * - **It is silent when it fails.** Offline is the normal case for a launch
 *   nobody asked anything of, and the bundled prices stay exactly as they
 *   were. A startup error box for something the person did not request is
 *   noise. The Items view still shows the date the prices carry, so a stale
 *   figure is never presented as fresh.
 * - **It has a floor.** tarkov.dev is a free community service and the prices
 *   move about hourly, so an hour-old catalogue is left alone. Opening the
 *   application once a session refreshes every time; opening it five times in
 *   ten minutes fetches once.
 */
const priceFloorMs = 60 * 60 * 1000;
async function refreshPricesOnLaunch() {
  const mode = store.data.mode;
  try {
    const current = loadItemCatalog(mode),
      stamp = Date.parse(current?.pricesUpdatedAt || current?.generatedAt || 0);
    if (Number.isFinite(stamp) && Date.now() - stamp < priceFloorMs) return;
    await updateItemCatalog(mode);
    // Only worth saying if the view that shows prices is already open.
    if (win && !win.isDestroyed()) win.webContents.send('prices-refreshed', mode);
  } catch {
    /* No network, or tarkov.dev is down. The bundled catalogue is still
       there and still stamped with its own date. */
  }
}
async function ensureOcrWorker() {
  if (!ocrWorkerPromise)
    ocrWorkerPromise = (async () => {
      const { createWorker, OEM } = require('tesseract.js'),
        language = require('@tesseract.js-data/eng');
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        langPath: language.langPath,
        workerPath: require.resolve('tesseract.js/src/worker-script/node/index.js'),
        corePath: path.dirname(require.resolve('tesseract.js-core/tesseract-core.wasm.js')),
        cachePath: path.join(app.getPath('userData'), 'ocr-cache'),
        logger: progress => {
          const done = progress.progress || 0,
            step = progress.status + ':' + Math.floor(done * 10);
          if (step === lastOcrProgress || win?.isDestroyed()) return;
          lastOcrProgress = step;
          win.webContents.send('ocr-progress', {
            status: progress.status,
            progress: done,
            context: ocrContext
          });
        }
      });
      await worker.setParameters({ preserve_interword_spaces: '1' });
      ocrWorker = worker;
      return worker;
    })().catch(error => {
      ocrWorkerPromise = null;
      throw error;
    });
  return ocrWorkerPromise;
}
function recognizeWithOcr(image, context) {
  const job = ocrQueue.then(async () => {
    const worker = await ensureOcrWorker();
    ocrContext = context;
    try {
      await worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: context === 'hotkey' ? '11' : '3'
      });
      return await worker.recognize(image, {}, { blocks: true, text: true });
    } finally {
      ocrContext = null;
    }
  });
  ocrQueue = job.catch(() => {});
  return job;
}
async function pickScreenshot(title) {
  const picked = await dialog.showOpenDialog(win, {
    title,
    properties: ['openFile'],
    filters: [{ name: 'Screenshot image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
  });
  if (picked.canceled) return null;
  const file = await fs.promises.realpath(picked.filePaths[0]),
    stat = await fs.promises.stat(file);
  if (!stat.isFile() || stat.size > 30 * 1024 * 1024)
    throw Error('Choose a screenshot smaller than 30 MB.');
  return file;
}
async function recognizeTasks(mode) {
  validateMode(mode);
  const file = await pickScreenshot('Scan Tarkov Tasks screenshot');
  if (!file) return null;
  const result = await recognizeWithOcr(file, 'tasks'),
    catalog = loadCatalog(mode),
    activeIds = Object.entries(store.data.profiles[mode].quests)
      .filter(([, value]) => value === 'active')
      .map(([id]) => id);
  return {
    file: path.basename(file),
    confidence: Math.round(result.data.confidence || 0),
    matches: parseTaskOcr(result.data.text, catalog.quests, activeIds),
    textPreview: String(result.data.text || '').slice(0, 12000)
  };
}
async function recognizeItem(mode) {
  validateMode(mode);
  const file = await pickScreenshot('Scan Tarkov item screenshot');
  if (!file) return null;
  const result = await recognizeWithOcr(file, 'item'),
    catalog = loadItemCatalog(mode);
  return {
    file: path.basename(file),
    confidence: Math.round(result.data.confidence || 0),
    matches: matchItemText(result.data.text, catalog),
    textPreview: String(result.data.text || '').slice(0, 8000),
    catalog: {
      generatedAt: catalog.generatedAt,
      pricesUpdatedAt: catalog.pricesUpdatedAt,
      source: catalog.source,
      count: catalog.items.length
    }
  };
}
function rubles(value) {
  return Number.isFinite(value) && value > 0
    ? new Intl.NumberFormat('en-US').format(Math.round(value)) + ' ₽'
    : '—';
}
function overlayPosition(cursor) {
  const display = screen.getDisplayNearestPoint(cursor),
    area = display.workArea,
    width = 360,
    height = 152;
  let x = cursor.x + 22,
    y = cursor.y + 22;
  if (x + width > area.x + area.width) x = cursor.x - width - 22;
  if (y + height > area.y + area.height) y = cursor.y - height - 22;
  return {
    x: Math.max(area.x, Math.min(x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - height)),
    width,
    height
  };
}
async function showPriceOverlay(payload, cursor) {
  clearTimeout(priceOverlayTimer);
  if (priceOverlay?.isDestroyed()) priceOverlay = null;
  const bounds = overlayPosition(cursor);
  if (!priceOverlay) {
    priceOverlay = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      show: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    priceOverlay.setIgnoreMouseEvents(true, { forward: true });
    priceOverlay.on('closed', () => {
      priceOverlay = null;
    });
  } else priceOverlay.setBounds(bounds);
  const state = JSON.stringify(payload);
  await priceOverlay.loadFile(path.join(assetRoot, 'price-overlay.html'), { query: { state } });
  priceOverlay.setAlwaysOnTop(true, 'screen-saver');
  priceOverlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  priceOverlay.showInactive();
  if (payload.state !== 'loading')
    priceOverlayTimer = setTimeout(
      () => priceOverlay && !priceOverlay.isDestroyed() && priceOverlay.hide(),
      7000
    );
}
// How wide a square of screen to judge the colour by. An inventory slot is
// about sixty pixels at 1080p and its name runs along the top of it, so a
// smaller centred box stays on the item itself whichever part of the slot the
// cursor is in.
const appearanceBox = 40;

// The crop is prepared before it is read: see imaging.cjs.
function liftText(image) {
  const { width, height } = image.getSize();
  if (!width || !height) return image;
  return nativeImage.createFromBitmap(liftTextPixels(image.toBitmap()), { width, height });
}
async function captureCursorRegions(cursor, specs) {
  const display = screen.getDisplayNearestPoint(cursor),
    requested = {
      width: Math.max(1, Math.round(display.size.width * display.scaleFactor)),
      height: Math.max(1, Math.round(display.size.height * display.scaleFactor))
    },
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: requested,
      fetchWindowIcons: false
    }),
    index = screen.getAllDisplays().findIndex(item => item.id === display.id),
    source =
      sources.find(item => item.display_id === String(display.id)) || sources[index] || sources[0];
  if (!source || source.thumbnail.isEmpty())
    throw Error('Screen capture is unavailable. Use borderless display mode and try again.');
  const size = source.thumbnail.getSize(),
    sx = size.width / display.bounds.width,
    sy = size.height / display.bounds.height,
    centerX = (cursor.x - display.bounds.x) * sx,
    centerY = (cursor.y - display.bounds.y) * sy;
  return specs.map(spec => {
    const regionWidth = Math.min(spec.width, display.bounds.width),
      regionHeight = Math.min(spec.height, display.bounds.height),
      width = Math.max(1, Math.round(regionWidth * sx)),
      height = Math.max(1, Math.round(regionHeight * sy)),
      x = Math.max(0, Math.min(Math.round(centerX - width / 2), size.width - width)),
      y = Math.max(0, Math.min(Math.round(centerY - height / 2), size.height - height)),
      scale = Math.max(1, Number(spec.scale) || 1),
      outWidth = scale > 1 ? Math.min(1800, Math.round(width * scale)) : width,
      outHeight = scale > 1 ? Math.min(1400, Math.round(height * scale)) : height;
    return {
      // Cropped and resampled only if this region is read. Most scans answer
      // from the first one and never touch the other two.
      png: () => {
        const crop = liftText(source.thumbnail.crop({ x, y, width, height }));
        return scale > 1
          ? crop.resize({ width: outWidth, height: outHeight, quality: 'best' }).toPNG()
          : crop.toPNG();
      },
      // The colour of what is under the cursor, taken before the text is
      // lifted, because lifting it throws the colour away. A small box so it
      // stays inside one inventory slot and clear of the name along its top.
      appearance: () => {
        const crop = source.thumbnail.crop({ x, y, width, height }),
          taken = crop.getSize(),
          side = Math.max(8, Math.round(appearanceBox * sx));
        return signatureOf(crop.toBitmap(), taken.width, taken.height, {
          left: Math.round(centerX - x - side / 2),
          top: Math.round(centerY - y - side / 2),
          width: side,
          height: side
        });
      },
      // The captured pixels as they came, for comparing the tile against the
      // artwork. Nothing is done to them: the comparison wants the colours the
      // game drew, and it works in captured pixels rather than screen ones.
      raw: () => {
        const crop = source.thumbnail.crop({ x, y, width, height }),
          taken = crop.getSize();
        return {
          bgra: crop.toBitmap(),
          width: taken.width,
          height: taken.height,
          cursorX: Math.round(centerX - x),
          cursorY: Math.round(centerY - y),
          // one screen pixel became this many captured pixels
          density: sx
        };
      },
      // Where the cursor lands inside this image, and how many image pixels one
      // screen pixel became, so the OCR line boxes can be read back in screen
      // pixels no matter which of the three crops they came from.
      cursorX: (centerX - x) * (outWidth / width),
      cursorY: (centerY - y) * (outHeight / height),
      density: (outWidth / width) * sx
    };
  });
}
// Places one OCR pass around the cursor, in screen pixels with the cursor at
// the origin.
function cursorLines(result, shot, group) {
  const lines = [];
  for (const block of result?.data?.blocks || [])
    for (const paragraph of block.paragraphs || [])
      for (const line of paragraph.lines || []) {
        const box = line.bbox;
        if (!box) continue;
        lines.push({
          group,
          text: String(line.text || '').trim(),
          left: (box.x0 - shot.cursorX) / shot.density,
          right: (box.x1 - shot.cursorX) / shot.density,
          top: (box.y0 - shot.cursorY) / shot.density,
          bottom: (box.y1 - shot.cursorY) / shot.density
        });
      }
  return lines;
}
// True while the cursor is inside a line of text the reading found.
function cursorOnText(lines) {
  return lines.some(line => line.left <= 0 && line.right >= 0 && line.top <= 0 && line.bottom >= 0);
}
// How much the colour under the cursor is allowed to move the order.
const appearanceWeight = 1;
// On an item rather than on a list, the reading is often damaged past the point
// where a name is worth offering on its own: "Pliers" comes back as "Bllers",
// "Shampoo" as "Shampoa". Those names are kept anyway and the colour decides
// between them. Worth two more right answers in fourteen on the bench, and it
// cannot reach the flea market list, where the names are read properly.
const weakNameFloor = 0.25,
  weakNameKeep = 60;
const shownMatches = 5;
// What a candidate keeps when no artwork is published for it, so an item the
// pack does not cover is not silently unreachable.
const pictureless = 0.55;
// How sure the artwork has to be before it may propose a name the reading never
// offered at all.
const pictureCertain = 0.8;
// The confidence at which a name is taken as read. Used twice, and the two
// uses mean the same thing: above this the scan stops widening, and above this
// the artwork is not asked for a second opinion.
const nameSettles = 0.76;
let appearanceCatalog, pictureCatalog;

// The artwork of every item, loaded the first time the shortcut is used.
function loadTemplates() {
  if (pictureCatalog === undefined)
    try {
      const index = JSON.parse(
        fs.readFileSync(path.join(assetRoot, 'data', 'item-templates.json'), 'utf8')
      );
      pictureCatalog =
        index.cell === templateCell
          ? new TemplateStore(
              index,
              fs.readFileSync(path.join(assetRoot, 'data', 'item-templates.bin'))
            )
          : null;
    } catch {
      pictureCatalog = null;
    }
  return pictureCatalog;
}

/*
 * Every reading of where the tile under the cursor might be, for a given shape.
 *
 * The grid is found from the capture rather than assumed: the phase is only
 * good to a pixel or two, an item wider or taller than one slot can hold the
 * cursor in any of its cells, and a small container gives the measurement very
 * little to work with, so all of it is tried and the best answer wins.
 */
function tileViews(around) {
  const shot = around.raw();
  if (!shot?.width || !shot?.height) return null;
  const grey = new Uint8Array(shot.width * shot.height);
  for (let p = 0, i = 0; p < grey.length; p++, i += 4)
    grey[p] = (0.0722 * shot.bgra[i] + 0.7152 * shot.bgra[i + 1] + 0.2126 * shot.bgra[i + 2]) | 0;
  const slot =
      slotSize(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).size.height) *
      shot.density,
    phases = gridPhases(grey, shot.width, shot.height, 0, 0, slot, 2),
    cache = new Map();
  return (slotsWide, slotsTall, thorough) => {
    const key = slotsWide + 'x' + slotsTall + (thorough ? 'f' : 'c');
    if (cache.has(key)) return cache.get(key);
    const sideX = Math.round(slot * slotsWide) + 1,
      sideY = Math.round(slot * slotsTall) + 1,
      nudges = thorough ? [-2, 0, 2] : [0],
      out = [];
    for (const px of phases.x)
      for (const py of phases.y)
        for (let dx = 0; dx < slotsWide; dx++)
          for (let dy = 0; dy < slotsTall; dy++)
            for (const nx of nudges)
              for (const ny of nudges) {
                const left = tileOrigin(shot.cursorX, px, phases.step) - Math.round(dx * slot) + nx,
                  top = tileOrigin(shot.cursorY, py, phases.step) - Math.round(dy * slot) + ny;
                if (left < 0 || top < 0 || left + sideX > shot.width || top + sideY > shot.height)
                  continue;
                // the cursor has to be inside the tile being proposed
                if (
                  shot.cursorX < left ||
                  shot.cursorX > left + sideX ||
                  shot.cursorY < top ||
                  shot.cursorY > top + sideY
                )
                  continue;
                out.push(
                  sampleTile(shot.bgra, shot.width, left, top, sideX, sideY, slotsWide, slotsTall)
                );
              }
    cache.set(key, out);
    return out;
  };
}
function loadAppearance() {
  if (appearanceCatalog === undefined)
    try {
      const doc = JSON.parse(
        fs.readFileSync(path.join(assetRoot, 'data', 'item-appearance.json'), 'utf8')
      );
      appearanceCatalog =
        doc?.signatures && typeof doc.signatures === 'object' ? doc.signatures : null;
    } catch {
      appearanceCatalog = null;
    }
  return appearanceCatalog;
}
// Names the cursor's own position and, where it can, what the thing looks like.
//
// Down a flea market list the name is directly under the pointer and reads
// reliably, and what is behind it is the list rather than the item, so the
// colour is left out of it entirely.
function identify(lines, catalog, seen, around) {
  const pictures = loadTemplates(),
    // Only when the cursor is on an item rather than on its name. Down a flea
    // market list the name is under the pointer and reads reliably, and behind
    // it is the list, not the item.
    onArtwork = !cursorOnText(lines);
  if (!onArtwork) return matchItemLines(lines, catalog, shownMatches);
  // The reading is often damaged past the point where a name is worth offering
  // on its own - "Pliers" comes back as "Bllers" - so weaker names are kept and
  // something else decides between them.
  const matches = matchItemLines(lines, catalog, weakNameKeep, weakNameFloor);
  if (matches.length < 2) return matches.slice(0, shownMatches);
  // The artwork is here for a reading too damaged to name the item. When the
  // name is settled it is the better evidence, and letting the pictures re-rank
  // it anyway costs answers: the template pack has a partial, differently lit
  // view of one tile, and for four of the fourteen measured positions it scored
  // the correct item below 0.5 - WI-FI Camera got 0.053 on its own artwork
  // while something else got 0.571. Measured over the whole set, consulting the
  // pictures unconditionally scores 11 of 14 and consulting them only for an
  // unsettled name scores 13, with the flea market unchanged at 14. The result
  // is flat for every threshold from 0.6 to 0.85, so it is not this number.
  if (matches[0].confidence >= nameSettles) return matches.slice(0, shownMatches);
  const judged = pictures && around ? matchByPicture(matches, pictures, around) : null;
  if (judged) return judged;
  return rankByColour(matches, seen);
}

// Ranks the names the reading offered by how much each one's artwork looks like
// the tile under the cursor.
function catalogItem(id) {
  for (const mode of ['seasonal', 'pvp', 'pve'])
    try {
      const found = loadItemCatalog(mode).items.find(item => item.id === id);
      if (found) return found;
    } catch {}
  return null;
}
function matchByPicture(matches, pictures, around) {
  const views = tileViews(around);
  if (!views) return null;
  const scored = pictures.identify(
    views,
    matches.map(match => match.id)
  );
  if (scored.length < 2) return null;
  // A name the reading lost outright can still be recovered from the artwork,
  // but only when the artwork is sure. Below that the catalogue is large enough
  // that something always correlates well by accident: searching all of it
  // named six tiles of twelve correctly on its own, against eleven when the
  // choice was already narrowed to a shortlist.
  const recovered = pictures
    .identify(views)
    .filter(
      entry => entry.score >= pictureCertain && !matches.some(match => match.id === entry.id)
    );
  if (recovered.length && recovered[0].score > (scored[0]?.score ?? 0)) {
    const item = catalogItem(recovered[0].id);
    if (item)
      return [
        {
          ...item,
          confidence: 0.5,
          score: recovered[0].score,
          looksLike: recovered[0].score,
          gap: 0,
          matchedText: ''
        },
        ...matches.slice(0, shownMatches - 1)
      ];
  }
  const looks = new Map(scored.map(entry => [entry.id, entry.score]));
  const ranked = matches
    .map(match => {
      const look = looks.get(match.id);
      return {
        ...match,
        looksLike: look === undefined ? null : look,
        // The picture decides; the name it was read from still counts, so a
        // candidate that was barely read cannot win on a lucky correlation.
        score: Number(
          (look === undefined
            ? match.score * pictureless
            : look * (0.6 + 0.4 * match.confidence)
          ).toFixed(4)
        )
      };
    })
    .sort((a, b) => b.score - a.score || (b.avg24hPrice || 0) - (a.avg24hPrice || 0));
  return ranked.slice(0, shownMatches);
}

// Falls back to the coarse colour comparison when there is no artwork on file.
function rankByColour(matches, seen) {
  const described = loadAppearance();
  if (!seen || !described) return matches.slice(0, shownMatches);
  const judged = matches.map(match => ({
    match,
    likeness: resemblance(seen, signatureFrom(described[match.id]))
  }));
  const best = Math.max(0, ...judged.map(entry => entry.likeness ?? 0));
  if (!best || judged.filter(entry => entry.likeness !== null).length < 2)
    return matches.slice(0, shownMatches);
  return judged
    .map(entry => {
      const like = entry.likeness === null ? 1 : entry.likeness / best;
      return {
        ...entry.match,
        looksLike: entry.likeness === null ? null : Number(like.toFixed(3)),
        score: Number(
          (entry.match.score * (1 - appearanceWeight + appearanceWeight * like)).toFixed(4)
        )
      };
    })
    .sort((a, b) => b.score - a.score || (b.avg24hPrice || 0) - (a.avg24hPrice || 0))
    .slice(0, shownMatches);
}
function clearInventoryMatch(matches, lines) {
  if (!matches[0] || matches[0].confidence < nameSettles) return false;
  // The cursor is on a name and the answer came from somewhere else, so that
  // name was not read. Answering with a neighbour would be a guess: a misread
  // "Bandana (1)" once came back as the baseball cap on the row below.
  if (cursorOnText(lines) && matches[0].gap > 0) return false;
  // Scores fade with distance from the cursor, so a fixed gap would mean
  // different things near and far. Compare them as a ratio instead. A tenth
  // ahead is enough: on the fourteen measured screen positions nothing below
  // that margin was ever wrong, and each widening costs a second, larger OCR
  // pass, which is most of the wait the user sees.
  return !matches[1] || matches[0].score >= matches[1].score * 1.1;
}
async function scanHoveredItem() {
  if (itemHotkeyRunning || !store?.data?.settings?.itemHotkeyEnabled) return;
  itemHotkeyRunning = true;
  const cursor = screen.getCursorScreenPoint();
  try {
    // Hiding a window is not instant, and the capture that follows would
    // otherwise photograph the last answer still on screen and read it back as
    // this one. Pressing the shortcut twice in a row did exactly that.
    if (priceOverlay && !priceOverlay.isDestroyed() && priceOverlay.isVisible()) {
      priceOverlay.hide();
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    const catalog = loadItemCatalog(store.data.mode),
      [tile, nearby, wide, around] = await captureCursorRegions(cursor, [
        { width: 320, height: 220, scale: 3 },
        { width: 720, height: 460, scale: 2 },
        { width: 1100, height: 760, scale: 1.5 },
        // Seven slots each way, so even a large item still falls inside it.
        { width: 448, height: 448, scale: 1 }
      ]);
    await showPriceOverlay({ state: 'loading', shortcut: ITEM_HOTKEY }, cursor);
    const seen = tile.appearance(),
      first = await recognizeWithOcr(tile.png(), 'hotkey');
    let text = String(first.data.text || ''),
      lines = cursorLines(first, tile, 'tile'),
      matches = identify(lines, catalog, seen, around),
      scanArea = 'inventory tile';
    if (!clearInventoryMatch(matches, lines)) {
      const fallback = await recognizeWithOcr(nearby.png(), 'hotkey');
      text += '\n' + String(fallback.data.text || '');
      lines = lines.concat(cursorLines(fallback, nearby, 'nearby'));
      matches = identify(lines, catalog, seen, around);
      scanArea = 'nearby inventory';
    }
    if (!matches[0]) {
      const fallback = await recognizeWithOcr(wide.png(), 'hotkey');
      text += '\n' + String(fallback.data.text || '');
      lines = lines.concat(cursorLines(fallback, wide, 'wide'));
      matches = identify(lines, catalog, seen, around);
      scanArea = 'expanded inventory';
    }
    const item = matches[0];
    if (item) {
      const closeMatches = matches.filter(match => match.score >= item.score * 0.87).length,
        noFlea = item.types?.includes('noFlea'),
        flea =
          !noFlea && item.avg24hPrice > 0
            ? item.avg24hPrice
            : !noFlea && item.lastLowPrice > 0
              ? item.lastLowPrice
              : null,
        trader = item.bestTrader?.price > 0 ? item.bestTrader.price : null,
        best = Math.max(flea || 0, trader || 0),
        slots = Math.max(1, (item.width || 1) * (item.height || 1)),
        perSlot = best ? best / slots : 0,
        threshold = Number(store.data.settings.itemValueThreshold) || 0,
        grade =
          closeMatches === 1 && threshold && perSlot >= threshold
            ? 'great'
            : closeMatches === 1 && threshold && perSlot >= threshold * 0.6
              ? 'good'
              : '';
      await showPriceOverlay(
        {
          state: 'result',
          name: item.name,
          shortName: item.shortName,
          match: Math.round(item.confidence * 100),
          possible: closeMatches,
          scanArea,
          flea: rubles(flea),
          trader: rubles(trader),
          traderName: item.bestTrader?.trader || 'No trader price',
          perSlot: rubles(perSlot || null),
          bestSource: best ? (flea !== null && flea >= trader ? 'Flea' : 'Trader') : 'No price',
          grade
        },
        cursor
      );
    } else
      await showPriceOverlay(
        {
          state: 'empty',
          message: 'No inventory item found',
          hint: 'Keep the cursor on the item tile and press ' + ITEM_HOTKEY + ' again.'
        },
        cursor
      );
    if (!win?.isDestroyed())
      win.webContents.send('item-hotkey-result', { matches, textPreview: text.slice(0, 8000) });
  } catch (error) {
    await showPriceOverlay(
      { state: 'error', message: 'Could not read this item', hint: error.message },
      cursor
    ).catch(() => {});
  } finally {
    itemHotkeyRunning = false;
  }
}
function configureItemHotkey() {
  if (itemHotkeyRegistered) {
    globalShortcut.unregister(ITEM_HOTKEY);
    itemHotkeyRegistered = false;
  }
  if (store?.data?.settings?.itemHotkeyEnabled)
    itemHotkeyRegistered = globalShortcut.register(ITEM_HOTKEY, () => scanHoveredItem());
  const status = {
    enabled: !!store?.data?.settings?.itemHotkeyEnabled,
    registered: itemHotkeyRegistered,
    accelerator: ITEM_HOTKEY
  };
  if (win && !win.isDestroyed() && !win.webContents.isLoading())
    win.webContents.send('item-hotkey-status', status);
  return status;
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
    icon: path.join(__dirname, 'app', 'assets', 'logo.png'),
    width: 1480,
    height: 940,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: '#101517',
    title: 'TarkovEyes',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
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
      token = require('node:crypto').randomUUID();
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
