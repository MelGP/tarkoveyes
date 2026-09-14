/*
 * Builds app/data/quest-wiki.json: the wiki page for every bundled quest, and
 * nothing else.
 *
 * The bundled catalogs carry no link of their own, and a page cannot be guessed
 * from a quest name - "The Tarkov Shooter - Part 1" is /wiki/The_Tarkov_Shooter
 * _-_Part_1 but "Debut" is /wiki/Debut_(quest), and a wrong link is worse than
 * none. tarkov.dev publishes wikiLink per task, so it is fetched once, here,
 * and the application reads a 40 KB map of id to URL instead of the network.
 *
 *   node tools/build/build-quest-wiki.js           write app/data/quest-wiki.json
 *   node tools/build/build-quest-wiki.js --check   report without writing
 */
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const dataDir = path.join(root, 'app/data');
const check = process.argv.includes('--check');
const out = path.join(dataDir, 'quest-wiki.json');

const sources = [
  { catalog: 'quests.json', dump: 'regular' },
  { catalog: 'quests-pve.json', dump: 'pve' },
  { catalog: 'quests-seasonal.json', dump: 'pvp-season' }
];

const questsIn = file => {
  const doc = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  return Array.isArray(doc) ? doc : doc.quests || Object.values(doc)[0];
};

(async () => {
  /* every id the application can actually show, so a link is never carried for
     a quest that is not bundled */
  const bundled = new Set();
  for (const { catalog } of sources) for (const quest of questsIn(catalog)) bundled.add(quest.id);

  const links = {};
  let fetched = 0;
  for (const { dump } of sources) {
    const response = await fetch('https://json.tarkov.dev/' + dump + '/tasks');
    if (!response.ok) throw new Error(dump + ' returned ' + response.status);
    const body = await response.json();
    const tasks = body.data?.tasks ?? body.tasks ?? body;
    for (const task of Object.values(tasks)) {
      fetched++;
      const id = String(task.id || '').toLowerCase();
      const link = String(task.wikiLink || '');
      if (!id || !bundled.has(id)) continue;
      /* only the fandom wiki, and only https - the file is read straight into
         an href, so anything else has no business being in it */
      if (!/^https:\/\/escapefromtarkov\.fandom\.com\/wiki\/[\w%().,'-]+$/i.test(link)) continue;
      links[id] = link;
    }
  }

  const sorted = Object.fromEntries(
    Object.keys(links)
      .sort()
      .map(id => [id, links[id]])
  );
  const covered = Object.keys(sorted).length;
  const missing = [...bundled].filter(id => !sorted[id]);

  console.log('bundled quests (all catalogs, deduplicated): ' + bundled.size);
  console.log('tasks read upstream:                         ' + fetched);
  console.log('with a usable wiki page:                     ' + covered);
  console.log('without one:                                 ' + missing.length);
  if (missing.length)
    console.log('  ' + missing.slice(0, 8).join(', ') + (missing.length > 8 ? ', …' : ''));

  if (check) {
    const before = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
    const added = Object.keys(sorted).filter(id => !before[id]).length;
    const changed = Object.keys(sorted).filter(
      id => before[id] && before[id] !== sorted[id]
    ).length;
    const dropped = Object.keys(before).filter(id => !sorted[id]).length;
    console.log(
      '\n--check: ' +
        added +
        ' added, ' +
        changed +
        ' changed, ' +
        dropped +
        ' dropped. Nothing written.'
    );
    return;
  }
  fs.writeFileSync(out, JSON.stringify(sorted, null, 1) + '\n');
  console.log(
    '\nwrote ' + path.relative(root, out) + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)'
  );
})().catch(error => {
  console.error('failed: ' + error.message);
  process.exit(1);
});
