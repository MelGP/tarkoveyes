/*
 * What an item looks like, coarsely enough to be worth carrying.
 *
 * The reading fails on a raid inventory in a way that has nothing to do with
 * the matcher: the name is a small grey label over the item's own artwork, and
 * it comes back as "llers" or "ME7" or not at all. But the artwork itself is
 * strongly coloured and the neighbours it gets confused with are not — a yellow
 * pair of pliers against a bright green shampoo bottle, a red medical bag
 * against a black magazine. Measured on the user's gear screen, the four tiles
 * the reading lost differ from the answers it gave by 30 to 130 units of mean
 * colour, which is not a subtle distinction.
 *
 * So the picture is not used to identify anything. It is used to re-rank the
 * handful of names the reading already produced, which needs nothing more than
 * a histogram: no tile boundaries to find, no rotation to undo, and the item's
 * size in slots does not matter.
 */

// Four levels per channel. Coarse on purpose: the capture is a different size,
// scaled differently, and lit by the game rather than by tarkov.dev's renderer.
const levels = 4;
const bins = levels * levels * levels;
// A tile's background is near black. Below this the pixel is the tile, not the
// item, and counting it would make a small item look like its empty slot.
const itemFloor = 46;

// Pixels arrive as BGRA, which is what both a desktop capture and a decoded
// image hand over.
function signatureOf(bgra, width, height, box) {
  const left = box ? Math.max(0, box.left) : 0,
    top = box ? Math.max(0, box.top) : 0,
    right = box ? Math.min(width, box.left + box.width) : width,
    bottom = box ? Math.min(height, box.top + box.height) : height,
    counts = new Float64Array(bins);
  let kept = 0;
  for (let y = top; y < bottom; y++) {
    let i = (y * width + left) * 4;
    for (let x = left; x < right; x++, i += 4) {
      const b = bgra[i],
        g = bgra[i + 1],
        r = bgra[i + 2];
      if (r < itemFloor && g < itemFloor && b < itemFloor) continue;
      counts[
        ((r * levels) >> 8) * levels * levels + ((g * levels) >> 8) * levels + ((b * levels) >> 8)
      ]++;
      kept++;
    }
  }
  if (!kept) return null;
  for (let i = 0; i < bins; i++) counts[i] /= kept;
  return counts;
}

// Stored as one byte per bin, which is finer than the measurement deserves.
function signatureBytes(counts) {
  return Buffer.from(counts.map(share => Math.round(Math.min(1, share) * 255))).toString('base64');
}
function signatureFrom(text) {
  const bytes = Buffer.from(String(text || ''), 'base64');
  if (bytes.length !== bins) return null;
  const counts = new Float64Array(bins);
  let total = 0;
  for (let i = 0; i < bins; i++) total += counts[i] = bytes[i];
  if (!total) return null;
  for (let i = 0; i < bins; i++) counts[i] /= total;
  return counts;
}

// Histogram intersection: 1 when the two describe the same spread of colour,
// 0 when they share none of it.
function resemblance(a, b) {
  if (!a || !b) return null;
  let shared = 0;
  for (let i = 0; i < bins; i++) shared += Math.min(a[i], b[i]);
  return shared;
}

export { signatureOf, signatureBytes, signatureFrom, resemblance, bins, itemFloor };
