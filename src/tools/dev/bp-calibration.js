/*
 * Battle Pass calibration sheets.
 *
 * For every mapped Battle Pass map this writes one PNG showing the same points
 * twice: on the left the community source image at its own coordinates, on the
 * right the tactical artwork at the coordinates tools/build/place-battlepass.js
 * produced. Both sides are normalised to 1000 x 1000 and share a grid, so a
 * point that drifted is visible as a different position in the same numbered
 * pair.
 *
 * Points that come from a detached building or floor diagram are drawn in blue
 * with a square marker: those are expected to move a long way between the two
 * sides, because the source draws them in an inset rather than on the map.
 *
 *   node tools/dev/bp-calibration.js            all maps
 *   node tools/dev/bp-calibration.js customs    one map
 *
 * Output: tools/sources/battlepass/calibration/<map>-points.png
 * This is a development aid. It proves nothing about in-game accuracy; it only
 * shows what the registration did.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
/* A specifier this file only knows at runtime. createRequire is how ESM
   resolves one; the alternative is a dynamic import(), which is async and
   would turn every caller into a promise for no gain here. */
const require = createRequire(import.meta.url);

function loadSharp() {
  /* sharp is not a dependency of this project - it is only needed by the two
     calibration tools, so it is borrowed from wherever the machine has one.
     SHARP_PATH names that copy; hard-coding one person's home directory here
     is what this replaced. */
  const candidates = ['sharp', process.env.SHARP_PATH].filter(Boolean);
  for (const id of candidates) {
    try {
      return require(id);
    } catch {}
  }
  throw Error('sharp is not available. Install it, or set SHARP_PATH to an existing copy.');
}

const sharp = loadSharp();
const root = path.resolve(import.meta.dirname, '../../app');
const defs = JSON.parse(
  fs.readFileSync(new URL('../../app/data/maps.json', import.meta.url), 'utf8')
);
const spawns = JSON.parse(
  fs.readFileSync(new URL('../../app/data/battlepass-spawns.json', import.meta.url), 'utf8')
);
const placement = JSON.parse(
  fs.readFileSync(new URL('../../app/data/battlepass-placement.json', import.meta.url), 'utf8')
);
const out = path.join(import.meta.dirname, '../sources/battlepass/calibration');
const only = process.argv[2];

const escape = text =>
  String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

function marks(points, side) {
  let svg = '';
  for (const p of points) {
    const x = side * 1000 + p.x * 1000;
    const y = 30 + p.y * 1000;
    const colour = p.detached ? '#6cc6ff' : '#ff5a4d';
    svg += p.detached
      ? `<rect x="${x - 6}" y="${y - 6}" width="12" height="12" fill="none" stroke="${colour}" stroke-width="2"/>`
      : `<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="${colour}" stroke-width="2"/>`;
    svg += `<circle cx="${x}" cy="${y}" r="1.6" fill="${colour}"/>`;
    svg +=
      `<text x="${x + 8}" y="${y - 7}" fill="${colour}" font-size="15" font-family="Consolas,monospace"` +
      ` stroke="#0b0f10" stroke-width="3" paint-order="stroke">${p.n}</text>`;
  }
  return svg;
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const written = [];
  for (const map of spawns.maps) {
    if (only && map.id !== only) continue;
    const def = defs.find(d => d.id === map.id);
    const placed = placement.maps.find(m => m.id === map.id);
    if (!def || !placed) {
      console.log('skipped ' + map.id + ': no tactical definition or placement');
      continue;
    }
    const byId = new Map(placed.points.map(p => [p.id, p]));
    const pairs = [];
    map.points.forEach((point, index) => {
      const target = byId.get(point.id);
      if (!target) return;
      pairs.push({
        n: index + 1,
        id: point.id,
        source: { x: point.x / map.width, y: point.y / map.height, n: index + 1 },
        target: { x: target.x, y: target.y, n: index + 1, detached: target.region !== 'main' },
        region: target.region,
        floor: target.floorLabel
      });
    });

    const left = await sharp(path.join(root, map.image))
      .resize(1000, 1000, { fit: 'fill' })
      .png()
      .toBuffer();
    let artwork = fs.readFileSync(path.join(root, 'assets', def.baseAsset.path));
    if (def.baseAsset.path.endsWith('.svg')) {
      const hidden = def.floors
        .filter(f => f.svgLayer)
        .map(f => `[id="${f.svgLayer}"]{display:none}`)
        .join('');
      artwork = Buffer.from(artwork.toString().replace('</svg>', `<style>${hidden}</style></svg>`));
    }
    const right = await sharp(artwork, { limitInputPixels: false })
      .resize(1000, 1000, { fit: 'fill' })
      .png()
      .toBuffer();

    let overlay = '<svg width="2000" height="1030" xmlns="http://www.w3.org/2000/svg">';
    for (let side = 0; side < 2; side++)
      for (let i = 100; i < 1000; i += 100)
        overlay +=
          `<path d="M${side * 1000 + i} 30v1000 M${side * 1000} ${i + 30}h1000"` +
          ' stroke="#ffea7b" stroke-opacity=".22" stroke-width="1"/>';
    overlay +=
      marks(
        pairs.map(p => p.source),
        0
      ) +
      marks(
        pairs.map(p => p.target),
        1
      );
    overlay +=
      `<text x="10" y="22" fill="#fff" font-size="18" font-family="Consolas,monospace">` +
      `${escape(map.id)} — community source, ${pairs.length} points</text>`;
    overlay +=
      `<text x="1010" y="22" fill="#fff" font-size="18" font-family="Consolas,monospace">` +
      `tactical artwork — red circle = main map, blue square = detached diagram</text>`;
    overlay += '</svg>';

    const file = path.join(out, map.id + '-points.png');
    await sharp({ create: { width: 2000, height: 1030, channels: 4, background: '#182021' } })
      .composite([
        { input: left, left: 0, top: 30 },
        { input: right, left: 1000, top: 30 },
        { input: Buffer.from(overlay) }
      ])
      .png()
      .toFile(file);
    const detached = pairs.filter(p => p.target.detached).length;
    written.push({ map: map.id, points: pairs.length, detached, file });
    console.log(
      map.id.padEnd(20) +
        String(pairs.length).padStart(3) +
        ' points, ' +
        String(detached).padStart(3) +
        ' from detached diagrams'
    );
  }
  console.log('\nwritten to ' + out);
  return written;
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
