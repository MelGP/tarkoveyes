/*
 * Builds app/data/keys.json: the name of every key a bundled locked door asks
 * for, and nothing else.
 *
 * The map view needs key names to label doors, and the only other source is the
 * 2.6 MB price catalog that the Items view loads on demand. Pulling that into
 * the map would cost a multi-megabyte parse to print a few hundred short
 * strings, so the names are extracted once, here, from the bundled catalogs.
 * Offline: it reads app/data, never the network.
 *
 *   node tools/build-keys.cjs                    write app/data/keys.json
 *   node tools/build-keys.cjs --download-icons   also fetch the key images
 *   node tools/build-keys.cjs --check   report without writing
 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'app/data');
const check = process.argv.includes('--check');
const downloadIcons = process.argv.includes('--download-icons');
const iconDir = path.join(root, 'app/assets/keys');

const wanted = new Set();
for (const file of fs.readdirSync(path.join(dataDir, 'poi'))) {
  const doc = JSON.parse(fs.readFileSync(path.join(dataDir, 'poi', file), 'utf8'));
  for (const poi of doc.pois)
    if (poi.kind === 'locked-door') for (const id of poi.keyIds || []) wanted.add(id);
}
// Quest briefs name keys the objectives require, and the raid kit needs to turn
// those names back into ids to find the doors, so quest keys are included too.
for (const file of ['quests.json', 'quests-pve.json', 'quests-seasonal.json']) {
  const full = path.join(dataDir, file);
  if (!fs.existsSync(full)) continue;
  for (const quest of JSON.parse(fs.readFileSync(full, 'utf8')).quests)
    for (const key of quest.neededKeys || []) if (key.id) wanted.add(key.id);
}

const names = new Map();
for (const file of ['items-seasonal.json', 'items-pvp.json', 'items-pve.json']) {
  const full = path.join(dataDir, file);
  if (!fs.existsSync(full)) continue;
  for (const item of JSON.parse(fs.readFileSync(full, 'utf8')).items)
    if (wanted.has(item.id) && !names.has(item.id))
      names.set(item.id, { name: item.name, shortName: item.shortName || undefined });
}

const missing = [...wanted].filter(id => !names.has(id));
const keys = Object.fromEntries(
  [...names.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
);
const doc = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: 'Bundled tarkov.dev item catalogs and POI files',
  keys
};

console.log('keys referenced by doors and quests: ' + wanted.size);
console.log('resolved to a name: ' + names.size);
if (missing.length) console.log('unresolved ids: ' + missing.join(', '));
if (check) {
  console.log('check only, nothing written');
  process.exit(missing.length ? 1 : 0);
}
// The item image is the one the game shows, which is what makes a key list
// readable at a glance. 197 of them cost about half a megabyte.
async function fetchIcons() {
  fs.mkdirSync(iconDir, { recursive: true });
  let saved = 0;
  for (const id of Object.keys(keys)) {
    const file = path.join(iconDir, id + '.webp');
    if (fs.existsSync(file) && fs.statSync(file).size > 200) continue;
    const response = await fetch('https://assets.tarkov.dev/' + id + '-icon.webp');
    if (!response.ok) throw Error(response.status + ' for key icon ' + id);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      bytes.length < 200 ||
      bytes.subarray(0, 4).toString() !== 'RIFF' ||
      bytes.subarray(8, 12).toString() !== 'WEBP'
    )
      throw Error('Not a WebP image for key ' + id);
    fs.writeFileSync(file, bytes);
    saved++;
  }
  console.log(
    'key icons downloaded: ' + saved + ', bundled in total: ' + fs.readdirSync(iconDir).length
  );
}
// Icons are fetched before the catalogue is written, so the icon paths land in
// the same pass. An early process.exit() here once killed the download midway.
function writeCatalog() {
  for (const [id, key] of Object.entries(keys))
    if (fs.existsSync(path.join(iconDir, id + '.webp'))) key.icon = 'assets/keys/' + id + '.webp';
  fs.writeFileSync(path.join(dataDir, 'keys.json'), JSON.stringify(doc));
  console.log(
    'wrote app/data/keys.json (' + (JSON.stringify(doc).length / 1024).toFixed(1) + ' KB)'
  );
}
(async () => {
  if (downloadIcons) await fetchIcons();
  writeCatalog();
  process.exitCode = missing.length ? 1 : 0;
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
