/*
 * Shift+F8: what is the thing under the cursor, and what is it worth.
 *
 * The screen around the pointer is captured at three scales, read locally,
 * and the lines are scored by what they say AND by how far they are from the
 * cursor - text below it is charged three times the distance, because an
 * interface labels what is beneath the label. When the reading does not settle
 * the item's own artwork breaks the tie; when it does, the artwork is not
 * consulted at all, because a template pack compared against a partial,
 * differently lit tile is the worse evidence and cost two right answers in
 * fourteen when it was asked unconditionally.
 *
 * Nothing here touches the game: it photographs the screen and reads pixels.
 * No memory access, no input hook, no synthetic input - a test asserts that
 * about every main-process file.
 *
 * It imports from main.js and main.js imports back. The cycle is safe because
 * nothing runs while the modules evaluate.
 */
/* Electron and node bindings, which the lifting tool does not carry: it only
   ever rewires local './x.js' imports, so a module it creates arrives using
   `fs` and `path` and importing neither. node --check cannot see that, and
   nor can any check that maps names to whoever exports them - these are not
   exported by anything. */
import { BrowserWindow, desktopCapturer, globalShortcut, nativeImage, screen } from 'electron';
import path from 'node:path';
import { assetRoot } from './paths.js';
import fs from 'node:fs';
import { recognizeWithOcr } from './ocr.js';
import { store, win } from './main.js';
import { loadItemCatalog } from './catalogs.js';
import { resemblance, signatureFrom, signatureOf } from '../lib/appearance.js';
import {
  TemplateStore,
  cell as templateCell,
  gridPhases,
  likeness,
  sampleTile,
  slotSize,
  tileOrigin
} from '../lib/templates.js';
/* Aliased on the way in, both of them, because the local names would collide:
   this module has its own liftText, and `cell` is far too plain to travel
   alone. An alias is invisible to a scanner that maps names to whoever
   exports them, so these two are the one pair the tooling could not move. */
import { liftText as liftTextPixels } from '../lib/imaging.js';
import { matchItemLines } from '../lib/items.js';

export let priceOverlay;

export let priceOverlayTimer;

export let itemHotkeyRunning = false;

export let itemHotkeyRegistered = false;

export const ITEM_HOTKEY = 'Shift+F8';

export function rubles(value) {
  return Number.isFinite(value) && value > 0
    ? new Intl.NumberFormat('en-US').format(Math.round(value)) + ' ₽'
    : '—';
}

export function overlayPosition(cursor) {
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

export async function showPriceOverlay(payload, cursor) {
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

// How wide a square of screen to judge the colour by. An inventory slot is
// about sixty pixels at 1080p and its name runs along the top of it, so a
// smaller centred box stays on the item itself whichever part of the slot the
// cursor is in.
export const appearanceBox = 40;

// The crop is prepared before it is read: see imaging.js.

// The crop is prepared before it is read: see imaging.js.
export function liftText(image) {
  const { width, height } = image.getSize();
  if (!width || !height) return image;
  return nativeImage.createFromBitmap(liftTextPixels(image.toBitmap()), { width, height });
}

export async function captureCursorRegions(cursor, specs) {
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

// Places one OCR pass around the cursor, in screen pixels with the cursor at
// the origin.
export function cursorLines(result, shot, group) {
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

// True while the cursor is inside a line of text the reading found.
export function cursorOnText(lines) {
  return lines.some(line => line.left <= 0 && line.right >= 0 && line.top <= 0 && line.bottom >= 0);
}
// How much the colour under the cursor is allowed to move the order.

// How much the colour under the cursor is allowed to move the order.
export const appearanceWeight = 1;
// On an item rather than on a list, the reading is often damaged past the point
// where a name is worth offering on its own: "Pliers" comes back as "Bllers",
// "Shampoo" as "Shampoa". Those names are kept anyway and the colour decides
// between them. Worth two more right answers in fourteen on the bench, and it
// cannot reach the flea market list, where the names are read properly.

// On an item rather than on a list, the reading is often damaged past the point
// where a name is worth offering on its own: "Pliers" comes back as "Bllers",
// "Shampoo" as "Shampoa". Those names are kept anyway and the colour decides
// between them. Worth two more right answers in fourteen on the bench, and it
// cannot reach the flea market list, where the names are read properly.
export const weakNameFloor = 0.25;

export const weakNameKeep = 60;

export const shownMatches = 5;
// What a candidate keeps when no artwork is published for it, so an item the
// pack does not cover is not silently unreachable.

// What a candidate keeps when no artwork is published for it, so an item the
// pack does not cover is not silently unreachable.
export const pictureless = 0.55;
// How sure the artwork has to be before it may propose a name the reading never
// offered at all.

// How sure the artwork has to be before it may propose a name the reading never
// offered at all.
export const pictureCertain = 0.8;
// The confidence at which a name is taken as read. Used twice, and the two
// uses mean the same thing: above this the scan stops widening, and above this
// the artwork is not asked for a second opinion.

// The confidence at which a name is taken as read. Used twice, and the two
// uses mean the same thing: above this the scan stops widening, and above this
// the artwork is not asked for a second opinion.
export const nameSettles = 0.76;

export let appearanceCatalog;

export let pictureCatalog;

// The artwork of every item, loaded the first time the shortcut is used.

// The artwork of every item, loaded the first time the shortcut is used.
export function loadTemplates() {
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

/*
 * Every reading of where the tile under the cursor might be, for a given shape.
 *
 * The grid is found from the capture rather than assumed: the phase is only
 * good to a pixel or two, an item wider or taller than one slot can hold the
 * cursor in any of its cells, and a small container gives the measurement very
 * little to work with, so all of it is tried and the best answer wins.
 */
export function tileViews(around) {
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

export function loadAppearance() {
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

// Names the cursor's own position and, where it can, what the thing looks like.
//
// Down a flea market list the name is directly under the pointer and reads
// reliably, and what is behind it is the list rather than the item, so the
// colour is left out of it entirely.
export function identify(lines, catalog, seen, around) {
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

// Ranks the names the reading offered by how much each one's artwork looks like
// the tile under the cursor.
export function catalogItem(id) {
  for (const mode of ['seasonal', 'pvp', 'pve'])
    try {
      const found = loadItemCatalog(mode).items.find(item => item.id === id);
      if (found) return found;
    } catch {}
  return null;
}

export function matchByPicture(matches, pictures, around) {
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

// Falls back to the coarse colour comparison when there is no artwork on file.
export function rankByColour(matches, seen) {
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

export function clearInventoryMatch(matches, lines) {
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

export async function scanHoveredItem() {
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

export function configureItemHotkey() {
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
