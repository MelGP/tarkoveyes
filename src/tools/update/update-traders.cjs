/*
 * Downloads the trader portraits the quest list shows, once, into
 * app/assets/traders, and writes app/data/traders.json.
 *
 * Development-time only and the only tool here that needs the network. It asks
 * tarkov.dev for the trader list, keeps just the traders the bundled quest
 * catalogs actually reference, and saves each portrait next to the item icons
 * the project already bundles from the same source.
 *
 *   node tools/update/update-traders.cjs           download what is missing
 *   node tools/update/update-traders.cjs --check    report without downloading
 *   node tools/update/update-traders.cjs --force    re-download everything
 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const dataDir = path.join(root, 'app/data');
const assetDir = path.join(root, 'app/assets/traders');
const check = process.argv.includes('--check');
const force = process.argv.includes('--force');

function bundledTraders() {
  const traders = new Map();
  for (const file of ['quests.json', 'quests-pve.json', 'quests-seasonal.json']) {
    const full = path.join(dataDir, file);
    if (!fs.existsSync(full)) continue;
    for (const quest of JSON.parse(fs.readFileSync(full, 'utf8')).quests)
      if (quest.traderId && !traders.has(quest.traderId))
        traders.set(quest.traderId, quest.traderName);
  }
  return traders;
}

async function run() {
  const traders = bundledTraders();
  console.log('traders referenced by the bundled catalogs: ' + traders.size);

  const remote = await fetch('https://json.tarkov.dev/regular/traders').then(r => {
    if (!r.ok) throw Error('traders ' + r.status);
    return r.json();
  });
  const list = Object.values(remote.data.traders || remote.data);
  const links = new Map(list.map(trader => [trader.id, trader.imageLink]));

  const entries = {};
  const missing = [];
  for (const [id, name] of traders) {
    const url = links.get(id);
    if (!url) {
      missing.push(name + ' (' + id + ')');
      continue;
    }
    const file = path.join(assetDir, id + '.webp');
    const relative = 'assets/traders/' + id + '.webp';
    entries[id] = { name, image: relative };
    if (check) continue;
    if (!force && fs.existsSync(file) && fs.statSync(file).size > 100) continue;
    const response = await fetch(url);
    if (!response.ok) throw Error(response.status + ' ' + url);
    const bytes = Buffer.from(await response.arrayBuffer());
    // Every portrait must really be a WebP; a 404 page saved as .webp would
    // leave a broken image in the quest list.
    if (
      bytes.length < 200 ||
      bytes.subarray(0, 4).toString() !== 'RIFF' ||
      bytes.subarray(8, 12).toString() !== 'WEBP'
    )
      throw Error('Not a WebP image: ' + url);
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(file, bytes);
    console.log('  saved ' + name.padEnd(14) + (bytes.length / 1024).toFixed(0) + ' KB');
  }

  if (missing.length) console.log('no portrait offered for: ' + missing.join(', '));
  if (check) {
    const onDisk = Object.values(entries).filter(entry =>
      fs.existsSync(path.join(root, 'app', entry.image))
    ).length;
    console.log('portraits already bundled: ' + onDisk + ' of ' + Object.keys(entries).length);
    return;
  }
  const doc = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'https://tarkov.dev',
    notice: 'Trader portraits from tarkov.dev, bundled for offline use like the item icons.',
    traders: entries
  };
  fs.writeFileSync(path.join(dataDir, 'traders.json'), JSON.stringify(doc));
  console.log('wrote app/data/traders.json with ' + Object.keys(entries).length + ' traders');
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
