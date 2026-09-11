/*
 * Builds app/data/boss-spawns.json: the spawn chance of every boss, per game
 * mode.
 *
 * The POI files were built from one snapshot, so every profile was shown the
 * PvP figure. The rates genuinely differ - Reshala is 60% in PvP and 75% in PvE,
 * the Lighthouse Rogues go from 50-90% to a flat 100% - so the mode the user
 * plays has to pick its own number.
 *
 * json.tarkov.dev publishes regular and pve. It does not publish the seasonal
 * mode; the API does, through a gameMode argument, so this tries that and falls
 * back to the PvP figures, recording that it did rather than inventing a rate.
 *
 *   node tools/update-boss-spawns.cjs
 *   node tools/update-boss-spawns.cjs --check
 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'app/data');
const check = process.argv.includes('--check');

const aliases = { ground_zero: 'ground-zero', lab: 'the-lab', labyrinth: 'the-labyrinth', streets_of_tarkov: 'streets-of-tarkov' };
const bundledMaps = new Set(JSON.parse(fs.readFileSync(path.join(dataDir, 'maps.json'), 'utf8')).map(map => map.id));

function collect(list) {
  const out = {};
  for (const map of list) {
    const id = aliases[map.normalizedName] || map.normalizedName;
    if (!bundledMaps.has(id)) continue;
    const perBoss = {};
    for (const entry of map.bosses || []) {
      const mob = entry.mob || entry.boss?.normalizedName;
      if (!mob || typeof entry.spawnChance !== 'number') continue;
      // A boss can hold several zones on one map; the highest chance is the one
      // worth quoting, which is what the marker shows.
      perBoss[mob] = Math.max(perBoss[mob] || 0, entry.spawnChance);
    }
    if (Object.keys(perBoss).length) out[id] = perBoss;
  }
  return out;
}

async function fromDump(mode) {
  const response = await fetch('https://json.tarkov.dev/' + mode + '/maps');
  if (!response.ok) throw Error(mode + ' maps ' + response.status);
  const payload = (await response.json()).data;
  return collect(Object.values(payload.maps || payload));
}

async function fromApi(gameMode) {
  const query = '{maps(gameMode: ' + gameMode + '){normalizedName bosses{spawnChance boss{normalizedName}}}}';
  const response = await fetch('https://api.tarkov.dev/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (!payload?.data?.maps) return null;
  return collect(payload.data.maps);
}

async function run() {
  const modes = { pvp: await fromDump('regular'), pve: await fromDump('pve') };
  let seasonalSource = 'pvp';
  const seasonal = await fromApi('pvpSeason').catch(() => null);
  if (seasonal && Object.keys(seasonal).length) {
    modes.seasonal = seasonal;
    seasonalSource = 'tarkov.dev pvpSeason';
  } else {
    modes.seasonal = modes.pvp;
    console.log('seasonal rates are not published in the static dump and the API was unreachable; reusing the PvP figures');
  }

  const differing = [];
  for (const [map, bosses] of Object.entries(modes.pvp))
    for (const [mob, chance] of Object.entries(bosses))
      if (modes.pve[map]?.[mob] !== undefined && Math.abs(modes.pve[map][mob] - chance) > 0.001)
        differing.push(map + '/' + mob);
  console.log('maps covered: ' + Object.keys(modes.pvp).length + ', boss rates that differ between PvP and PvE: ' + differing.length);
  if (check) return;

  fs.writeFileSync(
    path.join(dataDir, 'boss-spawns.json'),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: 'https://tarkov.dev',
      seasonalSource,
      notice:
        seasonalSource === 'pvp'
          ? 'Seasonal reuses the PvP figures: tarkov.dev does not publish seasonal spawn rates in the static dump.'
          : 'Seasonal figures come from the tarkov.dev API.',
      modes
    })
  );
  console.log('wrote app/data/boss-spawns.json (seasonal source: ' + seasonalSource + ')');
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
