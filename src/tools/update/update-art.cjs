/*
 * Downloads the game art the bundled data refers to: the picture the game shows
 * for each quest, and a portrait for each boss the POI files name.
 *
 * Development-time only, network required. Everything is stored locally so the
 * application itself never reaches out, exactly like the item icons and the
 * Battle Pass photographs it already bundles.
 *
 *   node tools/update/update-art.cjs                 both sets, skipping what exists
 *   node tools/update/update-art.cjs --quests        quest pictures only
 *   node tools/update/update-art.cjs --bosses        boss portraits only
 *   node tools/update/update-art.cjs --check         report what is missing, download nothing
 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const dataDir = path.join(root, 'app/data');
const check = process.argv.includes('--check');
const only = process.argv.includes('--quests')
  ? 'quests'
  : process.argv.includes('--bosses')
    ? 'bosses'
    : 'both';

async function save(url, file, label) {
  const response = await fetch(url);
  if (!response.ok) throw Error(response.status + ' for ' + label);
  const bytes = Buffer.from(await response.arrayBuffer());
  const webp =
    bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  const png = bytes.subarray(1, 4).toString() === 'PNG';
  // A 404 page saved under an image name would show up as a broken picture, so
  // the bytes have to look like the image they claim to be.
  if (bytes.length < 500 || !(webp || png)) throw Error('Not an image: ' + label);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return bytes.length;
}

function bundledQuestIds() {
  const ids = new Map();
  for (const file of ['quests.json', 'quests-pve.json', 'quests-seasonal.json']) {
    const full = path.join(dataDir, file);
    if (!fs.existsSync(full)) continue;
    for (const quest of JSON.parse(fs.readFileSync(full, 'utf8')).quests)
      ids.set(quest.id, quest.name);
  }
  return ids;
}

function bundledBosses() {
  const bosses = new Map();
  for (const file of fs.readdirSync(path.join(dataDir, 'poi')))
    for (const poi of JSON.parse(fs.readFileSync(path.join(dataDir, 'poi', file), 'utf8')).pois)
      if (poi.kind === 'boss-zone' && poi.bossName) bosses.set(poi.bossName, poi.bossId || '');
  return bosses;
}

// tarkov.dev names portraits after the boss, lower case, punctuation dropped and
// spaces turned into dashes: "Black Div. Raider" is black-div-raider-portrait.
const bossSlug = name =>
  name
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .trim()
    .replace(/\s+/g, '-');

async function quests() {
  const wanted = bundledQuestIds();
  const dir = path.join(root, 'app/assets/quests');
  const remote = (await (await fetch('https://json.tarkov.dev/regular/tasks')).json()).data.tasks;
  const links = new Map(Object.values(remote).map(task => [task.id, task.taskImageLink]));
  const images = {};
  let saved = 0,
    bytes = 0,
    missing = 0;
  for (const [id, name] of wanted) {
    const url = links.get(id);
    if (!url) {
      missing++;
      continue;
    }
    const file = path.join(dir, id + '.webp');
    images[id] = 'assets/quests/' + id + '.webp';
    if (check || (fs.existsSync(file) && fs.statSync(file).size > 500)) continue;
    bytes += await save(url, file, name);
    saved++;
    if (saved % 50 === 0) console.log('  ' + saved + ' quest pictures…');
  }
  console.log(
    'quests: ' +
      Object.keys(images).length +
      ' with a picture, ' +
      missing +
      ' without, ' +
      saved +
      ' downloaded' +
      (bytes ? ' (' + (bytes / 1024 / 1024).toFixed(1) + ' MB)' : '')
  );
  if (check) return;
  fs.writeFileSync(
    path.join(dataDir, 'quest-images.json'),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: 'https://tarkov.dev',
      images
    })
  );
}

async function bosses() {
  const wanted = bundledBosses();
  const dir = path.join(root, 'app/assets/bosses');
  const entries = {};
  const missing = [];
  let saved = 0;
  for (const [name, id] of wanted) {
    const slug = bossSlug(name);
    let stored = null;
    for (const extension of ['.webp', '.png']) {
      const file = path.join(dir, slug + extension);
      if (fs.existsSync(file) && fs.statSync(file).size > 500) {
        stored = 'assets/bosses/' + slug + extension;
        break;
      }
      if (check) continue;
      try {
        await save('https://assets.tarkov.dev/' + slug + '-portrait' + extension, file, name);
        stored = 'assets/bosses/' + slug + extension;
        saved++;
        break;
      } catch {}
    }
    if (stored) entries[name] = { id, image: stored };
    else missing.push(name);
  }
  console.log(
    'bosses: ' + Object.keys(entries).length + ' with a portrait, ' + saved + ' downloaded'
  );
  if (missing.length) console.log('  no portrait for: ' + missing.join(', '));
  if (check) return;
  fs.writeFileSync(
    path.join(dataDir, 'bosses.json'),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: 'https://tarkov.dev',
      bosses: entries
    })
  );
}

(async () => {
  if (only !== 'bosses') await quests();
  if (only !== 'quests') await bosses();
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
