#!/usr/bin/env node
/*
 * Put `faction` on the quests that have one.
 *
 * Nine quest names appear more than once in the bundled catalogues, and in the
 * rail they are indistinguishable - same name, same trader, no way to tell which
 * row is which. Make Amends appears three times. Measured on this profile, 17
 * such rows are visible under the default filter.
 *
 * They are two different things, and only upstream's `factionName` separates
 * them:
 *
 *   BEAR / USEC   Drip-Out Part 1 and 2, Textile Part 1 and 2 - genuinely one
 *                 quest per faction, and you can only ever do one of each pair.
 *   Any           Battery Change, Make Amends, The Huntsman Path -
 *                 Administrator, The Price of Independence, The Tarkov Shooter
 *                 - Part 5. Different tasks that happen to share a name, told
 *                 apart by their map or their objectives.
 *
 * Only BEAR and USEC are written. "Any" is 477 of 489 quests and storing it
 * would add a field to almost every record to say nothing.
 *
 * Usage:
 *   node tools/update/update-factions.cjs           write
 *   node tools/update/update-factions.cjs --check   report only
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const check = process.argv.includes('--check');
const catalogues = [
  ['quests.json', 'regular'],
  ['quests-pve.json', 'pve'],
  ['quests-seasonal.json', 'pvp-season']
];

async function tasks(dump) {
  const res = await fetch('https://json.tarkov.dev/' + dump + '/tasks', {
    headers: { 'user-agent': 'TarkovEyes (personal, non-commercial)' }
  });
  if (!res.ok) throw Error(dump + '/tasks -> ' + res.status);
  const doc = await res.json();
  const list = Array.isArray(doc) ? doc : Object.values(doc.data?.tasks || doc.tasks || doc);
  return new Map(list.map(q => [q.id, q]));
}

(async () => {
  let touched = 0;
  for (const [file, dump] of catalogues) {
    const full = path.join(root, 'app', 'data', file);
    if (!fs.existsSync(full)) continue;
    let upstream;
    try {
      upstream = await tasks(dump);
    } catch (error) {
      console.warn(file.padEnd(24) + 'skipped: ' + error.message);
      continue;
    }
    const doc = JSON.parse(fs.readFileSync(full, 'utf8'));
    const list = Array.isArray(doc) ? doc : doc.quests || doc.tasks;
    let changed = 0,
      named = 0;
    for (const quest of list) {
      const faction = upstream.get(quest.id)?.factionName;
      const want = faction === 'BEAR' || faction === 'USEC' ? faction : undefined;
      if (want) named++;
      if (quest.faction === want) continue;
      changed++;
      if (want) quest.faction = want;
      else delete quest.faction;
    }
    console.log(
      file.padEnd(24) +
        list.length +
        ' quests, ' +
        named +
        ' faction-specific' +
        (changed ? ', ' + changed + ' changed' : ', already current')
    );
    if (changed && !check) {
      fs.writeFileSync(full, JSON.stringify(doc));
      touched++;
    }
  }
  if (check) console.log('\n--check: nothing written.');
  else console.log('\n' + touched + ' file(s) updated.');
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
