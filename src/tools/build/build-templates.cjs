/*
 * Builds the picture of every item as the game draws it in an inventory tile,
 * small enough to carry and compare.
 *
 *   npx electron tools/build/build-templates.cjs          fetch what is missing
 *   npx electron tools/build/build-templates.cjs --check  report without writing
 *   npx electron tools/build/build-templates.cjs --all    rebuild every template
 *
 * tarkov.dev publishes each item's grid artwork at exactly the size the game
 * draws it: an item of n slots is 63n+1 pixels. That is what makes matching the
 * screen against it worth doing at all, and it is why the templates are stored
 * per slot rather than at some arbitrary size.
 *
 * Runs under Electron for its image decoder: the artwork is webp, which
 * nativeImage does not read but a hidden Chromium page does. Nothing is added
 * to the application's dependencies.
 *
 * Output is a binary pack plus a small index, because base64 in JSON would cost
 * a third more for no benefit.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { cell, bandRows, packRecord } = require('../../templates.cjs');

const root = path.join(__dirname, '../..');
const packFile = path.join(root, 'app', 'data', 'item-templates.bin');
const indexFile = path.join(root, 'app', 'data', 'item-templates.json');
const check = process.argv.includes('--check');
const all = process.argv.includes('--all');
const concurrency = 8;
require('node:fs').mkdirSync(
  require('node:path').join(require('node:os').tmpdir(), 'tarkoveyes-grid-artwork'),
  { recursive: true }
);

function items() {
  const seen = new Map();
  for (const mode of ['pvp', 'pve', 'seasonal']) {
    const file = path.join(root, 'app', 'data', 'items-' + mode + '.json');
    for (const item of JSON.parse(fs.readFileSync(file, 'utf8')).items)
      if (!seen.has(item.id))
        seen.set(item.id, { id: item.id, name: item.name, width: item.width, height: item.height });
  }
  return [...seen.values()];
}

function existing() {
  if (all) return null;
  try {
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8')),
      pack = fs.readFileSync(packFile);
    if (index.cell !== cell) return null;
    return { index, pack };
  } catch {
    return null;
  }
}

// A hidden page decodes the artwork and hands back the pixels, already reduced
// to the size the comparison uses.
let decoder;
async function decode(bytes, width, height) {
  if (!decoder) {
    decoder = new BrowserWindow({ show: false, width: 64, height: 64 });
    await decoder.loadURL('about:blank');
  }
  return decoder.webContents.executeJavaScript(
    '(async () => {' +
      '  const blob = await (await fetch("data:image/webp;base64,' +
      bytes.toString('base64') +
      '")).blob();' +
      '  const picture = await createImageBitmap(blob);' +
      '  const canvas = new OffscreenCanvas(' +
      width +
      ', ' +
      height +
      ');' +
      '  const context = canvas.getContext("2d");' +
      '  context.drawImage(picture, 0, 0, ' +
      width +
      ', ' +
      height +
      ');' +
      '  const data = context.getImageData(0, 0, ' +
      width +
      ', ' +
      height +
      ').data;' +
      '  let binary = "";' +
      '  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);' +
      '  return { ok: picture.width, rgba: btoa(binary) };' +
      '})()'
  );
}

// The artwork is kept on disk between runs. Re-packing at a different sample
// size or with different overlay bands is then instant instead of another
// twenty minutes of downloading.
const artwork = path.join(require('node:os').tmpdir(), 'tarkoveyes-grid-artwork');
async function fetchArtwork(id) {
  const file = path.join(artwork, id + '.webp');
  try {
    const bytes = fs.readFileSync(file);
    if (bytes.length >= 200) return bytes;
  } catch {}
  const response = await fetch('https://assets.tarkov.dev/' + id + '-grid-image.webp', {
    headers: { 'user-agent': 'TarkovEyes template builder' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 200) return null;
  fs.writeFileSync(file, bytes);
  return bytes;
}

async function templateOf(item) {
  const bytes = await fetchArtwork(item.id);
  if (!bytes) return null;
  const width = cell * item.width,
    height = cell * item.height,
    decoded = await decode(bytes, width, height);
  if (!decoded?.ok) return null;
  return packRecord(Buffer.from(decoded.rgba, 'base64'), item.width, item.height);
}

async function main() {
  const list = items(),
    have = existing(),
    kept = new Map();
  if (have)
    for (const [id, entry] of Object.entries(have.index.items))
      kept.set(id, have.pack.subarray(entry.at, entry.at + entry.bytes));
  const todo = list.filter(item => !kept.has(item.id));
  console.log(
    list.length + ' items, ' + kept.size + ' already drawn, ' + todo.length + ' to fetch'
  );
  if (check) return;

  let done = 0,
    missing = 0;
  const made = new Map(kept),
    queue = [...todo];
  const write = () => {
    const parts = [],
      index = {
        schemaVersion: 1,
        cell,
        bandRows,
        generatedAt: new Date().toISOString(),
        source: 'https://tarkov.dev',
        items: {}
      };
    let at = 0;
    for (const item of list) {
      const bytes = made.get(item.id);
      if (!bytes) continue;
      index.items[item.id] = { at, bytes: bytes.length, width: item.width, height: item.height };
      parts.push(bytes);
      at += bytes.length;
    }
    fs.writeFileSync(packFile, Buffer.concat(parts));
    fs.writeFileSync(indexFile, JSON.stringify(index));
  };
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const item = queue.shift();
        try {
          const record = await templateOf(item);
          if (record) made.set(item.id, record);
          else missing++;
        } catch {
          missing++;
        }
        // Saved as it goes; this takes twenty minutes over the network.
        if (++done % 250 === 0) {
          write();
          console.log('  ' + done + ' / ' + todo.length);
        }
      }
    })
  );
  write();
  console.log(
    'wrote ' +
      made.size +
      ' templates, ' +
      Math.round(fs.statSync(packFile).size / 1024) +
      ' KB of pixels, ' +
      missing +
      ' had no published artwork'
  );
}

app.whenReady().then(() =>
  main()
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => app.quit())
);
