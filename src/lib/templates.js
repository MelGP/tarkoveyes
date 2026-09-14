/*
 * Recognising an inventory tile by its picture.
 *
 * Reading the name off a raid inventory fails in a way no matcher can repair:
 * the label is tiny, printed over the item's own artwork, and comes back as
 * "Bllers" or "ME7" or not at all. The artwork itself is unambiguous, and
 * tarkov.dev publishes it at exactly the size the game draws it - an item of n
 * slots is 63n+1 pixels - so the screen can be compared against it directly.
 *
 * Measured on the user's own gear screen, twelve tiles across the backpack, rig
 * and pockets: eleven or twelve named correctly from the picture alone, against
 * the hundred and twenty most similar items of the same shape. The two signals
 * are complementary - two tins of fish look alike but read differently, a
 * misread label reads alike but looks different - which is why the scan uses
 * both.
 *
 * This is the approach RatScanner's RatEye library uses, arrived at
 * independently here and then confirmed against it.
 */

// An inventory slot at 1080p. Every icon is 63n+1 pixels for n slots, the extra
// pixel being the border shared with the next slot.
const baseSlot = 63;
// How finely a slot is described. Coarse on purpose: the capture is lit by the
// game and the reference by tarkov.dev's renderer, and finer templates measured
// no better while costing several times the space.
const cell = 16;
/*
 * The game prints the item's name across the top of a tile and a stack count or
 * resource bar across the bottom, and the reference artwork has neither, so
 * those bands are left out of every comparison.
 *
 * Measured off the screen rather than guessed: the label runs about eighteen
 * pixels down a sixty-three pixel slot and the counter about the same up from
 * the bottom, and leaving a row of either in cost a correct answer. They are
 * counted from the top and bottom of the whole item, because that is where the
 * game puts them however many slots tall it is - and they are applied when the
 * pack is read, not when it is built, so they can be changed without fetching
 * five thousand pictures again.
 */
const bandPixels = { top: 19, bottom: 19 };
const bandRows = {
  top: Math.ceil((cell * bandPixels.top) / baseSlot),
  bottom: Math.ceil((cell * bandPixels.bottom) / baseSlot)
};

// How much of the screen one slot takes, once the display is taken into
// account. The interface is laid out for 1080p and scales with height.
function slotSize(screenHeight) {
  return (baseSlot * (Number(screenHeight) || 1080)) / 1080;
}

// Packs one decoded icon: the colour of each sample, then a bit per sample
// saying whether it is the item rather than the empty slot behind it.
function packRecord(rgba, slotsWide, slotsTall) {
  const samples = cell * slotsWide * cell * slotsTall,
    colour = Buffer.alloc(samples * 3),
    mask = Buffer.alloc(Math.ceil(samples / 8));
  for (let p = 0, i = 0; p < samples; p++, i += 4) {
    colour[p * 3] = rgba[i];
    colour[p * 3 + 1] = rgba[i + 1];
    colour[p * 3 + 2] = rgba[i + 2];
    if (rgba[i + 3] > 160) mask[p >> 3] |= 1 << (p & 7);
  }
  return Buffer.concat([colour, mask]);
}

/*
 * Unpacks one record into the form the comparison wants.
 *
 * `mask` is the item's own pixels, minus the rows the game prints its name and
 * counters over. `judge` is every sample outside those rows, which is where the
 * silhouettes can fairly be compared. The centred colours and their spread are
 * worked out here because they never change, and recomputing them for each of
 * seven thousand comparisons was half the cost of a scan.
 */
function readRecord(bytes, slotsWide, slotsTall) {
  const samples = cell * slotsWide * cell * slotsTall,
    maskBits = bytes.subarray(samples * 3),
    alpha = new Uint8Array(samples);
  for (let p = 0; p < samples; p++) alpha[p] = (maskBits[p >> 3] >> (p & 7)) & 1;
  return finishRecord(bytes.subarray(0, samples * 3), alpha, slotsWide, slotsTall);
}

function finishRecord(colour, alpha, slotsWide, slotsTall) {
  const width = cell * slotsWide,
    height = cell * slotsTall,
    samples = width * height,
    mask = new Uint8Array(samples),
    judge = new Uint8Array(samples);
  let kept = 0,
    judged = 0;
  for (let p = 0; p < samples; p++) {
    const row = (p / width) | 0,
      inBand = row < bandRows.top || row >= height - bandRows.bottom;
    judge[p] = inBand ? 0 : 1;
    mask[p] = judge[p] && alpha[p] ? 1 : 0;
    kept += mask[p];
    judged += judge[p];
  }
  const centred = new Float64Array(samples * 3);
  let mean = 0,
    n = 0;
  for (let p = 0; p < samples; p++) {
    if (!mask[p]) continue;
    for (let c = 0; c < 3; c++) mean += colour[p * 3 + c];
    n += 3;
  }
  let energy = 0;
  if (n) {
    mean /= n;
    for (let p = 0; p < samples; p++) {
      if (!mask[p]) continue;
      for (let c = 0; c < 3; c++) {
        const value = colour[p * 3 + c] - mean;
        centred[p * 3 + c] = value;
        energy += value * value;
      }
    }
  }
  return {
    colour,
    alpha,
    mask,
    judge,
    centred,
    energy: Math.sqrt(energy),
    kept,
    judged,
    slotsWide,
    slotsTall
  };
}

/*
 * How alike two pictures are, over the item's own pixels.
 *
 * Correlation rather than difference, because the game lights a tile by where
 * it is and brightens the one under the cursor, and none of that says which
 * item it is.
 *
 * This is decisive between a handful of candidates and unreliable across the
 * whole catalogue: among the hundred and twenty most similar items of the same
 * shape it named eleven of twelve tiles correctly, but against all seven
 * thousand pictures only six, because with that many rivals something always
 * correlates well by accident. Comparing silhouettes as well was tried to fix
 * that and made it worse - a tile the item fills completely has no background
 * to measure one against. So the names choose who is in the running and this
 * decides between them, which is the arrangement the measurements support.
 */
function likeness(seen, model) {
  const { mask, centred, energy } = model;
  let seenMean = 0,
    n = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    for (let c = 0; c < 3; c++) seenMean += seen[p * 3 + c];
    n += 3;
  }
  if (n < 30) return -1;
  seenMean /= n;
  let dot = 0,
    seenEnergy = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    for (let c = 0; c < 3; c++) {
      const a = seen[p * 3 + c] - seenMean;
      dot += a * centred[p * 3 + c];
      seenEnergy += a * a;
    }
  }
  const spread = Math.sqrt(seenEnergy) * energy;
  return spread > 0 ? dot / spread : -1;
}

/*
 * Where the inventory grid falls.
 *
 * A real grid line is present at every multiple of the slot size; the edge of a
 * picture is not. Scoring a phase by its weakest line rather than its average
 * is what separates the two, and the best few phases are all returned because
 * a small container gives the measurement very little to work with.
 */
function gridPhases(grey, width, height, left, top, slot, keep = 3) {
  const columns = new Float64Array(width),
    rows = new Float64Array(height);
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      columns[x] += Math.abs(grey[y * width + x - 1] - grey[y * width + x + 1]);
      rows[y] += Math.abs(grey[(y - 1) * width + x] - grey[(y + 1) * width + x]);
    }
  const step = Math.max(8, Math.round(slot));
  const choose = (energy, length, origin) => {
    const scored = [];
    for (let phase = 0; phase < step; phase++) {
      const lines = [];
      for (let i = phase; i < length; i += step) if (i > 0 && i < length - 1) lines.push(energy[i]);
      if (lines.length < 2) continue;
      lines.sort((a, b) => a - b);
      scored.push({
        strength: lines[Math.floor(lines.length / 2)],
        phase: (origin + phase) % step
      });
    }
    return scored
      .sort((a, b) => b.strength - a.strength)
      .slice(0, keep)
      .map(entry => entry.phase);
  };
  return { x: choose(columns, width, left), y: choose(rows, height, top), step };
}

// Where the tile holding this point begins.
function tileOrigin(at, phase, step) {
  return at - ((((at - phase) % step) + step) % step);
}

/*
 * One tile of captured screen, reduced to the same samples as a template.
 *
 * Averaging rather than picking pixels: the tile is six times wider than the
 * sample grid, and throwing away five pixels in six would make the result turn
 * on exactly where the grid happened to land.
 */
function sampleTile(bgra, pitch, left, top, sideX, sideY, slotsWide, slotsTall) {
  const width = cell * slotsWide,
    height = cell * slotsTall,
    out = new Float64Array(width * height * 3);
  for (let sy = 0; sy < height; sy++) {
    const fromY = top + Math.floor((sy * sideY) / height),
      toY =
        top +
        Math.max(Math.floor(((sy + 1) * sideY) / height), Math.floor((sy * sideY) / height) + 1);
    for (let sx = 0; sx < width; sx++) {
      const fromX = left + Math.floor((sx * sideX) / width),
        toX =
          left +
          Math.max(Math.floor(((sx + 1) * sideX) / width), Math.floor((sx * sideX) / width) + 1);
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let y = fromY; y < toY; y++) {
        let i = (y * pitch + fromX) * 4;
        for (let x = fromX; x < toX; x++, i += 4) {
          b += bgra[i];
          g += bgra[i + 1];
          r += bgra[i + 2];
          n++;
        }
      }
      const at = (sy * width + sx) * 3;
      out[at] = n ? r / n : 0;
      out[at + 1] = n ? g / n : 0;
      out[at + 2] = n ? b / n : 0;
    }
  }
  return out;
}

/*
 * The catalogue of pictures, and the search over it.
 *
 * Two passes. The first scores every item once, from the tile the cursor is in;
 * it is cheap because a template is only a few hundred numbers. The second
 * takes the few that looked promising and tries them against every reasonable
 * reading of where the grid falls, which is where the exactness comes from.
 */
class TemplateStore {
  constructor(index, pack) {
    this.cell = index.cell;
    this.shapes = new Map();
    for (const [id, entry] of Object.entries(index.items || {})) {
      const record = readRecord(
        pack.subarray(entry.at, entry.at + entry.bytes),
        entry.width,
        entry.height
      );
      if (!record.kept) continue;
      for (const turned of entry.width === entry.height ? [false] : [false, true]) {
        const wide = turned ? entry.height : entry.width,
          tall = turned ? entry.width : entry.height,
          key = wide + 'x' + tall;
        if (!this.shapes.has(key)) this.shapes.set(key, { wide, tall, entries: [] });
        this.shapes.get(key).entries.push({ id, turned, record: turned ? turn(record) : record });
      }
    }
  }
  get size() {
    let total = 0;
    for (const shape of this.shapes.values()) total += shape.entries.length;
    return total;
  }
  /*
   * `views(slotsWide, slotsTall, thorough)` hands back every reading of the
   * screen worth trying for that shape: where the grid might fall, which of the
   * item's own cells the cursor might be in, and a pixel or two either way. The
   * first pass asks for the cheap set and the second for all of it.
   */
  identify(views, only) {
    const wanted = only ? new Set(only) : null,
      thorough = new Map(),
      scores = new Map();
    for (const shape of this.shapes.values()) {
      const entries = wanted ? shape.entries.filter(entry => wanted.has(entry.id)) : shape.entries;
      if (!entries.length) continue;
      const key = shape.wide + 'x' + shape.tall;
      if (!thorough.has(key)) thorough.set(key, views(shape.wide, shape.tall, true));
      const looks = thorough.get(key);
      if (!looks.length) continue;
      for (const entry of entries) {
        let best = -1;
        for (const samples of looks) best = Math.max(best, likeness(samples, entry.record));
        // an item that can lie either way keeps whichever way looked better
        const prior = scores.get(entry.id);
        if (!prior || best > prior.score)
          scores.set(entry.id, {
            id: entry.id,
            turned: entry.turned,
            score: Number(best.toFixed(4))
          });
      }
    }
    return [...scores.values()].sort((a, b) => b.score - a.score);
  }
}

/*
 * The same picture stood on its side, for an item turned in the inventory.
 *
 * The bands are applied afterwards rather than rotated with it: the game prints
 * the name along the top of the tile as it is laid out on screen, which for a
 * turned item is a different edge of the artwork.
 */
function turn(record) {
  const width = cell * record.slotsWide,
    height = cell * record.slotsTall,
    colour = Buffer.alloc(width * height * 3),
    alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      // a quarter turn clockwise: the row becomes the column
      const from = y * width + x,
        to = x * height + (height - 1 - y);
      colour[to * 3] = record.colour[from * 3];
      colour[to * 3 + 1] = record.colour[from * 3 + 1];
      colour[to * 3 + 2] = record.colour[from * 3 + 2];
      alpha[to] = record.alpha[from];
    }
  return finishRecord(colour, alpha, record.slotsTall, record.slotsWide);
}

export {
  baseSlot,
  cell,
  bandRows,
  slotSize,
  packRecord,
  readRecord,
  likeness,
  gridPhases,
  tileOrigin,
  sampleTile,
  turn,
  TemplateStore
};
