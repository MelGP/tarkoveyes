import fs from 'fs';
import path from 'path';
import { createRequire } from 'node:module';
/* A specifier this file only knows at runtime. createRequire is how ESM
   resolves one; the alternative is a dynamic import(), which is async and
   would turn every caller into a promise for no gain here. */
const require = createRequire(import.meta.url);
/* sharp is not a dependency of this project; see loadSharp() in
   bp-calibration.js. SHARP_PATH names a copy on this machine. */
const sharp = (() => {
  for (const id of ['sharp', process.env.SHARP_PATH].filter(Boolean)) {
    try {
      return require(id);
    } catch {}
  }
  throw Error('sharp is not available. Install it, or set SHARP_PATH to an existing copy.');
})();
const root = path.resolve(import.meta.dirname, '../../app'),
  maps = JSON.parse(fs.readFileSync(new URL('../../app/data/maps.json', import.meta.url), 'utf8')),
  bp = JSON.parse(
    fs.readFileSync(new URL('../../app/data/battlepass-spawns.json', import.meta.url), 'utf8')
  );
const out = path.join(import.meta.dirname, '../sources/battlepass/calibration');
fs.mkdirSync(out, { recursive: true });
(async () => {
  for (const m of bp.maps) {
    const d = maps.find(d => d.id === m.id),
      source = path.join(root, m.image),
      target = path.join(root, 'assets', d.baseAsset.path);
    const left = await sharp(source).resize(1000, 1000, { fit: 'fill' }).png().toBuffer();
    let buf = fs.readFileSync(target);
    if (target.endsWith('.svg')) {
      let s = buf.toString();
      s = s.replace(
        '</svg>',
        `<style>${d.floors
          .filter(f => f.svgLayer)
          .map(f => '[id="' + f.svgLayer + '"]{display:none}')
          .join('')}</style></svg>`
      );
      buf = Buffer.from(s);
    }
    const right = await sharp(buf, { limitInputPixels: false })
      .resize(1000, 1000, { fit: 'fill' })
      .png()
      .toBuffer();
    let grid = '<svg width="2000" height="1030">';
    for (let side = 0; side < 2; side++) {
      for (let i = 100; i < 1000; i += 100) {
        grid += `<path d="M${side * 1000 + i} 30v1000 M${side * 1000} ${i + 30}h1000" stroke="#ffea7b" stroke-opacity=".4" stroke-width="1"/><text x="${side * 1000 + i + 2}" y="50" fill="yellow" font-size="16">${i}</text><text x="${side * 1000 + 2}" y="${i + 30}" fill="yellow" font-size="16">${i}</text>`;
      }
    }
    grid += `<text x="10" y="22" fill="white" font-size="20">${m.id} SOURCE normalized 1000</text><text x="1010" y="22" fill="white" font-size="20">TARGET normalized 1000</text></svg>`;
    await sharp({ create: { width: 2000, height: 1030, channels: 4, background: '#182021' } })
      .composite([
        { input: left, left: 0, top: 30 },
        { input: right, left: 1000, top: 30 },
        { input: Buffer.from(grid) }
      ])
      .png()
      .toFile(path.join(out, m.id + '.png'));
  }
  console.log(out);
})();
