// Development-time data refresh only. Not included in packaged application.
// Adds the key and item names the renderer shows to the bundled quest catalogs.
// Pass --dry to report what would change without writing the catalogs.
import fs from 'node:fs';
const dry = process.argv.includes('--dry');
async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw Error(url + ' ' + r.status);
  return JSON.parse(await r.text());
}
function itemName(names, id) {
  return names[id + ' Name'] || names[id + ' name'] || id;
}
// tarkov.dev keeps separate ids for map variants; TarkovEyes bundles one map for each.
const mapAliases = {
  'night-factory': 'factory',
  'ground-zero-21': 'ground-zero',
  'ground-zero-tutorial': 'ground-zero',
  'the-lab-dark': 'the-lab'
};
async function mapIdsByTarkovDevId() {
  const raw = (await json('https://json.tarkov.dev/regular/maps')).data;
  const list = Array.isArray(raw) ? raw : Object.values(raw.maps || raw);
  const bundled = new Set(
    JSON.parse(fs.readFileSync('app/data/maps.json', 'utf8')).map(map => map.id)
  );
  const byId = new Map();
  for (const map of list) {
    const id = mapAliases[map.normalizedName] || map.normalizedName;
    if (bundled.has(id)) byId.set(map.id, id);
  }
  return byId;
}
async function run() {
  const names = (await json('https://json.tarkov.dev/regular/items_en')).data;
  const mapIds = await mapIdsByTarkovDevId();
  for (const [mode, file] of [
    ['regular', 'quests'],
    ['pve', 'quests-pve']
  ]) {
    const raw = (await json('https://json.tarkov.dev/' + mode + '/tasks')).data.tasks;
    const doc = JSON.parse(fs.readFileSync('app/data/' + file + '.json', 'utf8'));
    let missingMaps = 0;
    for (const q of doc.quests) {
      const task = raw[q.id];
      if (!task) continue;
      // Every map, not only Customs: a key list that silently drops other maps is
      // worse than no key list, because the brief then looks complete.
      const keys = new Map();
      for (const group of task.neededKeys || []) {
        const mapId = mapIds.get(group.map);
        if (group.map && !mapId) missingMaps++;
        for (const id of group.keys || []) {
          const entry = keys.get(id) || { id, name: itemName(names, id), mapIds: [] };
          if (mapId && !entry.mapIds.includes(mapId)) entry.mapIds.push(mapId);
          keys.set(id, entry);
        }
      }
      q.neededKeys = [...keys.values()].map(entry =>
        entry.mapIds.length ? entry : { id: entry.id, name: entry.name }
      );
      for (const o of q.objectives) {
        const item = task.objectives.find(x => x.id === o.id);
        if (!item) continue;
        o.requiredKeys = (item.requiredKeys || []).map(group =>
          group.map(id => itemName(names, id))
        );
        o.itemNames = (item.items || []).slice(0, 12).map(id => itemName(names, id));
      }
    }
    const withKeys = doc.quests.filter(q => q.neededKeys?.length).length;
    const mapsCovered = new Set(
      doc.quests.flatMap(q => (q.neededKeys || []).flatMap(k => k.mapIds || []))
    );
    if (!dry) {
      doc.requirementsUpdatedAt = new Date().toISOString();
      fs.writeFileSync('app/data/' + file + '.json', JSON.stringify(doc));
    }
    console.log(
      mode +
        ': ' +
        withKeys +
        ' quests carry keys across ' +
        mapsCovered.size +
        ' bundled maps' +
        (missingMaps
          ? ' (' + missingMaps + ' key groups on maps this build does not bundle)'
          : '') +
        (dry ? ' — dry run, nothing written.' : '.')
    );
  }
}
run().catch(e => {
  console.error(e.message);
  process.exitCode = 1;
});
