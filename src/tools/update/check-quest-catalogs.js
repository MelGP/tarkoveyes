/*
 * Answers one question: would refreshing the quest catalogs change anything,
 * and can the seasonal one be refreshed at all right now?
 *
 * It compares each bundled catalog with what tarkov.dev serves today, tries the
 * API for the seasonal mode (the static dump does not publish it), and lists the
 * quest ids in the saved progress that no bundled catalog knows - the ones the
 * Activity card counts as "detected from logs".
 *
 *   node tools/update/check-quest-catalogs.js
 *
 * Read-only: it downloads nothing and writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const root = path.resolve(import.meta.dirname, '../..');
const dataDir = path.join(root, 'app/data');
const progressFile = path.join(os.homedir(), 'AppData/Roaming/TarkovEyes/local-data/progress.json');

const catalogs = [
  { mode: 'pvp', file: 'quests.json', dump: 'regular' },
  { mode: 'pve', file: 'quests-pve.json', dump: 'pve' },
  // The seasonal dump lives under a hyphenated name; pvpSeason only works on the API.
  { mode: 'seasonal', file: 'quests-seasonal.json', dump: 'pvp-season', gameMode: 'pvpSeason' }
];

async function dumpTasks(name) {
  const response = await fetch('https://json.tarkov.dev/' + name + '/tasks');
  if (!response.ok) throw Error(name + ' tasks ' + response.status);
  return Object.keys((await response.json()).data.tasks);
}

async function apiTasks(gameMode) {
  const response = await fetch('https://api.tarkov.dev/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{tasks(gameMode: ' + gameMode + '){id}}' })
  });
  const text = await response.text();
  if (!response.ok || text.includes('"errors"')) return { ok: false, reason: text.slice(0, 120) };
  return { ok: true, ids: JSON.parse(text).data.tasks.map(task => task.id) };
}

(async () => {
  const known = new Set();
  for (const entry of catalogs) {
    const full = path.join(dataDir, entry.file);
    if (!fs.existsSync(full)) continue;
    const doc = JSON.parse(fs.readFileSync(full, 'utf8'));
    entry.bundled = doc.quests.map(quest => quest.id);
    entry.generatedAt = doc.generatedAt;
    for (const id of entry.bundled) known.add(id);
  }
  const tracks = path.join(dataDir, 'special-tracks.json');
  if (fs.existsSync(tracks))
    for (const quest of JSON.parse(fs.readFileSync(tracks, 'utf8')).quests || [])
      known.add(quest.id);

  console.log('catalogue           bundled   upstream   missing   extra   source');
  for (const entry of catalogs) {
    if (!entry.bundled) continue;
    let upstream = null,
      note = '';
    if (entry.dump) {
      try {
        upstream = await dumpTasks(entry.dump);
        note = 'json.tarkov.dev/' + entry.dump;
      } catch (error) {
        note = 'unreachable: ' + error.message;
      }
    } else {
      const attempt = await apiTasks(entry.gameMode);
      if (attempt.ok) {
        upstream = attempt.ids;
        note = 'api gameMode ' + entry.gameMode;
      } else note = 'API unavailable, no static dump publishes this mode';
    }
    const bundled = new Set(entry.bundled);
    const missing = upstream ? upstream.filter(id => !bundled.has(id)).length : '-';
    const extra = upstream ? entry.bundled.filter(id => !upstream.includes(id)).length : '-';
    console.log(
      entry.mode.padEnd(20) +
        String(entry.bundled.length).padStart(7) +
        String(upstream ? upstream.length : '-').padStart(11) +
        String(missing).padStart(10) +
        String(extra).padStart(8) +
        '   ' +
        note
    );
  }

  if (!fs.existsSync(progressFile)) {
    console.log('\nNo saved progress found, so nothing to compare against.');
    return;
  }
  const progress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
  console.log('\nquest ids in the saved progress that no bundled catalogue knows:');
  for (const [mode, profile] of Object.entries(progress.profiles || {})) {
    const unknown = Object.keys(profile.quests || {}).filter(id => !known.has(id));
    if (!unknown.length) {
      console.log('  ' + mode.padEnd(10) + 'none');
      continue;
    }
    const byState = {};
    for (const id of unknown) byState[profile.quests[id]] = (byState[profile.quests[id]] || 0) + 1;
    console.log(
      '  ' +
        mode.padEnd(10) +
        unknown.length +
        '  (' +
        Object.entries(byState)
          .map(([k, v]) => k + ': ' + v)
          .join(', ') +
        ')'
    );
    console.log(
      '             ' + unknown.slice(0, 4).join(', ') + (unknown.length > 4 ? ', …' : '')
    );
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
