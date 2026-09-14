#!/usr/bin/env node
/*
 * Refresh the BTR stops in the bundled POI files from tarkov.dev.
 *
 * The POI files were generated once, on 28 August 2026, and no tool rebuilt
 * them afterwards - which is why a BTR that appears on a new map in a game
 * patch would never arrive here. This does the one slice that keeps changing.
 *
 * It also recovers something the original generation threw away. Upstream, a
 * stop's name is a localisation key:
 *
 *     Trading/Dialog/PlayerTaxi/Woods/p5/Name
 *
 * The `p5` is the game's own number for that stop, and it is NOT the order the
 * stops appear in the array - on Woods the array runs p5, p4, p1, p2, p7, p8,
 * p3, p6. The bundled files had numbered them `btr-0` upward in array order, so
 * every id here was a number that meant nothing. `stop` carries the real one.
 *
 * Usage:
 *   node tools/update/update-btr.js           write the changes
 *   node tools/update/update-btr.js --check   report without writing
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '../..');
const poiDir = path.join(root, 'app', 'data', 'poi');
const check = process.argv.includes('--check');
const endpoint = 'https://json.tarkov.dev/regular/maps';
const englishEndpoint = 'https://json.tarkov.dev/regular/maps_en';

/* The bundled map ids do not all match upstream's normalizedName. */
const mapAliases = { 'streets-of-tarkov': 'streets-of-tarkov' };

async function json(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'TarkovEyes (personal, non-commercial)' }
  });
  if (!res.ok) throw Error(url + ' -> ' + res.status);
  return res.json();
}

function mapList(doc) {
  const maps = doc.data?.maps || doc.maps || Object.values(doc)[0];
  return Array.isArray(maps) ? maps : Object.values(maps);
}

(async () => {
  const [payload, english] = await Promise.all([json(endpoint), json(englishEndpoint)]);
  const upstream = new Map();
  for (const m of mapList(payload)) upstream.set(m.normalizedName, m);
  /* maps_en is not another copy of the maps - it is a flat dictionary of every
     localisation key to its English string, so a stop name is looked up by the
     key the stop carries rather than by position in an array. Assuming the
     other shape produced eight stops all called "Stop N". */
  const names = english.data || english;

  let changed = 0,
    files = 0;
  for (const file of fs.readdirSync(poiDir).filter(f => f.endsWith('.json'))) {
    const full = path.join(poiDir, file),
      doc = JSON.parse(fs.readFileSync(full, 'utf8')),
      mapId = doc.mapId || file.replace('.json', ''),
      source = upstream.get(mapAliases[mapId] || mapId);
    if (!source) continue;
    const stops = source.btrStops || [];

    const fresh = stops.map((stop, index) => {
      const number = Number((String(stop.name).match(/\/p(\d+)\//) || [])[1]);
      return {
        id: 'btr-' + (Number.isFinite(number) ? number : index),
        kind: 'btr',
        category: 'btr',
        /* The dictionary resolves the key; fall back to the number so a stop
           is never nameless. */
        name: names[stop.name] || 'Stop ' + (Number.isFinite(number) ? number : index + 1),
        stop: Number.isFinite(number) ? number : index + 1,
        position: { x: stop.x, y: stop.y, z: stop.z }
      };
    });

    const before = doc.pois.filter(p => p.kind === 'btr');
    const same =
      before.length === fresh.length &&
      JSON.stringify(before.map(p => [p.id, p.name, p.stop, p.position])) ===
        JSON.stringify(fresh.map(p => [p.id, p.name, p.stop, p.position]));
    if (same) continue;

    files++;
    changed += Math.abs(fresh.length - before.length) || fresh.length;
    console.log(
      mapId.padEnd(22) +
        before.length +
        ' -> ' +
        fresh.length +
        ' stops' +
        (check ? '  (check)' : '')
    );
    for (const s of fresh) console.log('    p' + s.stop + '  ' + s.name);
    if (check) continue;

    doc.pois = doc.pois.filter(p => p.kind !== 'btr').concat(fresh);
    doc.btrUpdatedAt = new Date().toISOString();
    fs.writeFileSync(full, JSON.stringify(doc));
  }

  if (!files) console.log('BTR stops already match tarkov.dev.');
  else if (check) console.log('\n' + files + ' file(s) would change. Re-run without --check.');
  else console.log('\n' + files + ' file(s) updated.');
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
