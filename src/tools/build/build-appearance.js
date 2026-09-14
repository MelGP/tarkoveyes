/*
 * Builds a colour signature for every item, so the hotkey can tell apart names
 * the reading could not.
 *
 *   npx electron tools/build/build-appearance.js          build the missing ones
 *   npx electron tools/build/build-appearance.js --check  report without writing
 *   npx electron tools/build/build-appearance.js --all    rebuild every signature
 *
 * It runs under Electron because that is where an image decoder lives in this
 * project; nothing is added to the application's dependencies. tarkov.dev's
 * grid image is the same artwork the game draws in an inventory tile, which is
 * exactly what the screen capture will be compared against.
 *
 * Only the signature is kept. The pictures themselves are not bundled: a coarse
 * histogram is about seventy bytes, so the whole catalogue is well under a
 * megabyte, and the comparison at scan time costs a fraction of a millisecond.
 */
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { signatureOf, signatureBytes } from '../../lib/appearance.js';

const root = path.join(import.meta.dirname, '../..');
const target = path.join(root, 'app', 'data', 'item-appearance.json');
const check = process.argv.includes('--check');
const all = process.argv.includes('--all');
const concurrency = 8;

function items() {
  const seen = new Map();
  for (const mode of ['pvp', 'pve', 'seasonal']) {
    const file = path.join(root, 'app', 'data', 'items-' + mode + '.json');
    for (const item of JSON.parse(fs.readFileSync(file, 'utf8')).items)
      if (!seen.has(item.id)) seen.set(item.id, item.name);
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

function existing() {
  try {
    const doc = JSON.parse(fs.readFileSync(target, 'utf8'));
    return doc.signatures || {};
  } catch {
    return {};
  }
}

// The pictures are webp, which Electron's own image decoder does not read but
// its Chromium does. A hidden page decodes them and hands back the pixels; the
// bytes are fetched here rather than in the page so no cross-origin rule
// applies to a request this tool is making of itself.
let decoder;
async function decodePixels(bytes) {
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
      '  const canvas = new OffscreenCanvas(picture.width, picture.height);' +
      '  const context = canvas.getContext("2d");' +
      '  context.drawImage(picture, 0, 0);' +
      '  const data = context.getImageData(0, 0, picture.width, picture.height).data;' +
      '  let binary = "";' +
      '  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);' +
      '  return { width: picture.width, height: picture.height, rgba: btoa(binary) };' +
      '})()'
  );
}

async function fetchSignature(id) {
  const response = await fetch('https://assets.tarkov.dev/' + id + '-grid-image.webp', {
    headers: { 'user-agent': 'TarkovEyes appearance builder' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 200) return null;
  const decoded = await decodePixels(bytes);
  if (!decoded?.width || !decoded?.height) return null;
  const rgba = Buffer.from(decoded.rgba, 'base64'),
    bgra = Buffer.allocUnsafe(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    bgra[i] = rgba[i + 2];
    bgra[i + 1] = rgba[i + 1];
    bgra[i + 2] = rgba[i];
    bgra[i + 3] = rgba[i + 3];
  }
  return signatureOf(bgra, decoded.width, decoded.height);
}

async function main() {
  const list = items(),
    have = all ? {} : existing(),
    todo = list.filter(item => !have[item.id]);
  console.log(list.length + ' items, ' + (list.length - todo.length) + ' already described');
  if (check || !todo.length) {
    console.log(todo.length + ' would be fetched');
    return;
  }
  const signatures = { ...have };
  let done = 0,
    missing = 0;
  const queue = [...todo];
  const save = () =>
    fs.writeFileSync(
      target,
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        source: 'https://tarkov.dev',
        note: 'Coarse colour histograms of the in-game grid artwork, used to separate items the reading could not name.',
        signatures
      })
    );
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const item = queue.shift();
        try {
          const signature = await fetchSignature(item.id);
          if (signature) signatures[item.id] = signatureBytes(signature);
          else missing++;
        } catch {
          missing++;
        }
        // Written as it goes: this takes twenty minutes and losing all of it to
        // an interruption once was enough.
        if (++done % 250 === 0) {
          save();
          console.log('  ' + done + ' / ' + todo.length);
        }
      }
    })
  );
  save();
  console.log(
    'wrote ' +
      Object.keys(signatures).length +
      ' signatures (' +
      Math.round(fs.statSync(target).size / 1024) +
      ' KB), ' +
      missing +
      ' had no published picture'
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
