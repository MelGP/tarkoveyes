import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  parseScreenshot,
  parseLogLine,
  lineTime,
  parseQuestNotifications,
  scanQuestHistory,
  canonicalMap,
  worldToMap,
  objectiveTarget,
  parseTaskOcr,
  Store,
  Observer
} from '../lib/core.js';

/* The renderer is several modules now, not one file. Every assertion here is
   about "what the renderer does", so they read the whole of it: a declaration
   that moves from app.js to vocabulary.js is a refactor, not a behaviour
   change, and should not fail a test. */
function rendererSource() {
  const dir = path.join(import.meta.dirname, '..', 'app');
  return fs
    .readdirSync(dir)
    .filter(name => name.endsWith('.js'))
    .sort()
    .map(name => fs.readFileSync(path.join(dir, name), 'utf8'))
    .join(String.fromCharCode(10));
}
const shot = '2026-09-05[16-54] _ 178.07, 2.877, 148.702_0, 0, 0, 1_18.34 (0).png';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raidnotes-test-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), dir);
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      !path.basename(dir).startsWith('raidnotes-test-')
    )
      throw Error('Invalid test cleanup path');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
test('current filename yields coordinates and raw screenshot heading', () => {
  assert.deepEqual(parseScreenshot(shot), { x: 178.07, y: 2.877, z: 148.702, heading: 0 });
});
test('position-only filename works; unrelated, invalid and huge values fail closed', () => {
  assert.deepEqual(parseScreenshot('2024-01-02[03-04]_1, -2.5, 3.25 (0).PNG'), {
    x: 1,
    y: -2.5,
    z: 3.25,
    heading: null
  });
  for (const name of [
    'holiday.png',
    '[12-23]_999999, 2, 3.png',
    '[12-23]_NaN, 1, 2.png',
    '[12-23]_1, 2, 3.exe'
  ])
    assert.equal(parseScreenshot(name), null);
});
test('quaternion normalization is invariant to scale', () => {
  assert.equal(
    parseScreenshot('[00-00]_1, 2, 3_0, 0.7, 0, 0.7.png').heading,
    parseScreenshot('[00-00]_1, 2, 3_0, 1.4, 0, 1.4.png').heading
  );
});
test('map projection anchors and known dorm objective align', () => {
  const a = worldToMap({ x: 698, z: -307 }),
    b = worldToMap({ x: -372, z: 237 });
  assert.equal(a.x, 0);
  assert.equal(a.y, 0);
  assert.equal(b.x, 1062.4827);
  assert.equal(b.y, 535.17401);
  const p = worldToMap({ x: 178.07, z: 148.702 });
  assert.ok(p.x > 515 && p.x < 518);
  assert.ok(p.y > 447 && p.y < 450);
});
test('Labs uses tarkov.dev orientation and places known official landmarks consistently', () => {
  const maps = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/maps.json'), 'utf8')
  );
  const lab = maps.find(map => map.id === 'the-lab');
  assert.ok(lab);
  assert.equal(lab.coordinateRotation, 270);
  const project = ({ x, z }) => {
    const radians = (lab.coordinateRotation * Math.PI) / 180,
      cos = Math.cos(radians),
      sin = Math.sin(radians);
    const rotate = point => ({
      x: point.x * cos - point.z * sin,
      z: point.x * sin + point.z * cos
    });
    const [[x1, z1], [x2, z2]] = lab.bounds;
    const corners = [
      { x: x1, z: z1 },
      { x: x1, z: z2 },
      { x: x2, z: z1 },
      { x: x2, z: z2 }
    ].map(rotate);
    const q = rotate({ x, z }),
      minX = Math.min(...corners.map(p => p.x)),
      maxX = Math.max(...corners.map(p => p.x)),
      minZ = Math.min(...corners.map(p => p.z)),
      maxZ = Math.max(...corners.map(p => p.z));
    return { x: (q.x - minX) / (maxX - minX), y: (maxZ - q.z) / (maxZ - minZ) };
  };
  const parkingGate = project({ x: -231.73, z: -434.816 }),
    hangarGate = project({ x: -170.66, z: -245.94 }),
    testRoom = project({ x: -130, z: -356 });
  assert.ok(
    parkingGate.x < 0.2 && parkingGate.y < 0.35,
    'Parking Gate must remain in the upper-left of the official Labs artwork'
  );
  assert.ok(
    hangarGate.x > 0.75,
    'Hangar Gate must remain on the right of the official Labs artwork'
  );
  assert.ok(
    testRoom.x > 0.35 && testRoom.x < 0.5 && testRoom.y > 0.7,
    'Weapon Test area must remain in its official lower-middle position'
  );
});
test('Labs movement and facing direction follow a real screenshot sequence', () => {
  const maps = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '../app/data/maps.json'), 'utf8')
    ),
    lab = maps.find(map => map.id === 'the-lab');
  const first = parseScreenshot(
    '[20-41]_-170.16, 1.47, -414.27_-0.09282, -0.26285, 0.02531, -0.96003_6.79 (0).png'
  );
  const second = parseScreenshot(
    '[20-41]_-173.09, 1.48, -401.05_0.04161, -0.08166, 0.00635, 0.99577_6.79 (0).png'
  );
  const project = position => ({
    x: ((position.z + 477) / 284) * 720,
    y: ((position.x + 287) / 207) * 586
  });
  const a = project(first),
    b = project(second),
    movementBearing = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
  const markerBearing = (((second.heading - lab.coordinateRotation) % 360) + 360) % 360;
  assert.ok(
    b.x > a.x && b.y < a.y,
    'this verified Labs path must move up and right on the official artwork'
  );
  assert.ok(
    Math.abs(markerBearing - movementBearing) < 8,
    'the player arrow must face along the verified path'
  );
});
test('Labs keycard legend resolves every colored-card door from bundled POIs', () => {
  const poi = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/poi/the-lab.json'), 'utf8')
  );
  const catalog = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/lab-keycards.json'), 'utf8')
  );
  assert.equal(catalog.mapId, 'the-lab');
  assert.equal(catalog.keycards.length, 8);
  const cards = new Map(catalog.keycards.map(card => [card.id, card])),
    doors = poi.pois.filter(
      item => item.kind === 'locked-door' && (item.keyIds || []).some(id => cards.has(id))
    );
  assert.equal(doors.length, 9);
  assert.equal(doors.filter(item => item.keyIds.includes('5c1d0f4986f7744bb01837fa')).length, 2);
  assert.deepEqual(
    new Set(catalog.keycards.map(card => card.label)),
    new Set(['BLUE', 'GREEN', 'RED', 'VIOLET', 'YELLOW', 'BLACK', 'BLUE MARK', 'RES UNIT'])
  );
  for (const card of catalog.keycards) {
    assert.match(card.color, /^#[0-9a-f]{6}$/i);
    assert.ok(card.room);
    assert.equal(card.iconPath, '/items/labs-keycards/' + card.id + '.webp');
    const icon = path.join(import.meta.dirname, '../app/assets', card.iconPath.replace(/^\/+/, ''));
    assert.ok(fs.existsSync(icon), card.label + ' icon');
    const bytes = fs.readFileSync(icon);
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
    assert.ok(
      doors.some(door => door.keyIds.includes(card.id)),
      card.label + ' door'
    );
  }
});
test('Reserve chess landmarks match the building clusters identified by RB keys', () => {
  const renderer = rendererSource(),
    block = renderer.match(/reserve:\s*\[(.*?)\n\s*\]/s)?.[1];
  assert.ok(block);
  const entries = [
    ...block.matchAll(/\[\s*'([^']+)',\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*'([^']+)'/g)
  ].map(match => ({ name: match[1], x: Number(match[2]), z: Number(match[3]), piece: match[4] }));
  assert.deepEqual(
    new Set(entries.map(item => item.name)),
    new Set([
      'WHITE QUEEN · DOME',
      'WHITE PAWN',
      'BLACK PAWN',
      'BLACK BISHOP',
      'WHITE BISHOP',
      'WHITE KING',
      'BLACK KNIGHT',
      'WHITE KNIGHT'
    ])
  );
  assert.ok(
    entries.every(item => Number.isFinite(item.x) && Number.isFinite(item.z) && item.piece)
  );
  const pois = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '../app/data/poi/reserve.json'), 'utf8')
    ).pois,
    anchors = {
      'WHITE QUEEN · DOME': '5da46e3886f774653b7a83fe',
      'WHITE PAWN': '5d80ccac86f77470841ff452',
      'BLACK PAWN': '5d80c60f86f77440373c4ece',
      'BLACK BISHOP': '5d80c78786f774403a401e3e',
      'WHITE BISHOP': '5d947d4e86f774447b415895',
      'WHITE KING': '5da5cdcd86f774529238fb9b',
      'BLACK KNIGHT': '5d80c93086f7744036212b41',
      'WHITE KNIGHT': '5d80cbd886f77470855c26c2'
    };
  for (const item of entries) {
    const anchor = pois.find(poi => poi.keyIds?.includes(anchors[item.name]));
    assert.ok(anchor, item.name + ' RB-key anchor');
    assert.ok(
      Math.hypot(item.x - anchor.position.x, item.z - anchor.position.z) < 28,
      item.name + ' stays on its verified building cluster'
    );
  }
});
test('every profile catalog still carries the key and item data the raid kit lists', () => {
  const renderer = rendererSource();
  assert.match(renderer, /function raidKit\(/, 'renderer keeps the raid kit builder');
  assert.match(
    renderer,
    /function questKeyList\(/,
    'quest briefs build their key list from objectives'
  );
  const carryTypes = [...renderer.matchAll(/(\w+):\s*'(?:Plant|Hand in|Use)'/g)].map(
    match => match[1]
  );
  assert.ok(
    carryTypes.includes('plantItem') && carryTypes.includes('giveItem'),
    'carried objective types stay mapped'
  );
  for (const file of ['quests.json', 'quests-pve.json', 'quests-seasonal.json']) {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '../app/data', file), 'utf8')
    );
    let groups = 0,
      carried = 0;
    for (const quest of catalog.quests)
      for (const objective of quest.objectives) {
        for (const group of objective.requiredKeys || []) {
          assert.ok(
            Array.isArray(group) && group.length,
            file + ': ' + quest.name + ' has an empty key group'
          );
          assert.ok(
            group.every(name => typeof name === 'string' && name.trim()),
            file + ': ' + quest.name + ' has a blank key name'
          );
          groups++;
        }
        if (carryTypes.includes(objective.type) && (objective.itemNames || []).length) carried++;
      }
    assert.ok(groups >= 50, file + ' lost its objective key requirements (' + groups + ')');
    assert.ok(
      carried >= 200,
      file + ' lost the item names of carried objectives (' + carried + ')'
    );
  }
});
test('log parser limits itself to map/lifecycle records', () => {
  assert.deepEqual(
    parseLogLine(
      'x|application|scene preset path:maps/customs_preset.bundle rcid:bigmap.scenespreset.asset'
    ),
    { type: 'map', map: 'customs' }
  );
  assert.deepEqual(parseLogLine('x Location: woods, state ready'), { type: 'map', map: 'woods' });
  assert.deepEqual(parseLogLine('x|application|GameStarted:'), { type: 'start' });
  assert.deepEqual(parseLogLine('x UserMatchOver'), { type: 'end' });
  assert.deepEqual(parseLogLine('x|application|Session mode: Pve'), { type: 'mode', mode: 'pve' });
  assert.deepEqual(parseLogLine('x|application|Session mode: Regular'), {
    type: 'mode',
    mode: 'pvp'
  });
  assert.deepEqual(parseLogLine('x|application|Session mode: PvpSeason'), {
    type: 'mode',
    mode: 'seasonal'
  });
  assert.equal(parseLogLine('quest_accepted arbitrary secret account info'), null);
});
test('log aliases resolve to every supported location id', () => {
  const cases = {
    bigmap: 'customs',
    woods: 'woods',
    factory4_day: 'factory',
    sandbox: 'ground-zero',
    interchange: 'interchange',
    lighthouse: 'lighthouse',
    rezervbase: 'reserve',
    shoreline: 'shoreline',
    tarkovstreets: 'streets-of-tarkov',
    laboratory: 'the-lab',
    labyrinth: 'the-labyrinth',
    terminal: 'terminal',
    icebreaker: 'icebreaker'
  };
  for (const [alias, id] of Object.entries(cases)) assert.equal(canonicalMap(alias), id);
});
test('quest notification parser accepts only identified lifecycle events', () => {
  const prefix =
    '2026-09-05 22:00:00.000|1.1|Info|push-notifications|Got notification | ChatMessageReceived\n';
  const completed =
    prefix +
    JSON.stringify(
      {
        eventId: 'event-1',
        message: {
          type: 12,
          dt: 1788552000,
          text: 'quest started',
          templateId: '665eec1f5e47a79f8605565a successMessageText'
        }
      },
      null,
      2
    ) +
    '\n';
  const unrelated =
    prefix +
    JSON.stringify(
      {
        eventId: 'event-x',
        message: {
          type: 11,
          dt: 1788552000,
          text: 'quest started',
          templateId: '665eec1f5e47a79f8605565a 0'
        }
      },
      null,
      2
    ) +
    '\n';
  const unidentified =
    prefix +
    JSON.stringify(
      { eventId: 'event-2', message: { type: 10, dt: 1788552001, text: 'quest started' } },
      null,
      2
    ) +
    '\n';
  assert.deepEqual(parseQuestNotifications(completed + unrelated + unidentified), [
    {
      type: 'quest',
      id: '665eec1f5e47a79f8605565a',
      status: 'completed',
      trader: null,
      eventId: 'event-1',
      observedAt: 1788552000000
    }
  ]);
  assert.deepEqual(parseQuestNotifications(prefix + '{broken json}\n'), []);
});
test('full log refresh reads every session and keeps profiles separate', async t => {
  const dir = fixture(t),
    questA = '665eec1f5e47a79f8605565a',
    questB = '665eec4a4dfc83b0ed0a9dca';
  const sessions = [
    ['01', 'Pvp', questA, 10, 100, 'description'],
    ['02', 'Pvp', questA, 12, 200, 'successMessageText'],
    ['03', 'PvpSeason', questA, 10, 300, 'description'],
    ['04', 'PvpSeason', questB, 10, 400, 'description'],
    ['05', 'PvpSeason', questB, 11, 500, 'failMessageText']
  ];
  for (const [name, mode, id, type, dt, suffix] of sessions) {
    const folder = path.join(dir, name);
    fs.mkdirSync(folder);
    fs.writeFileSync(
      path.join(folder, 'application_000.log'),
      'x|application|Session mode: ' + mode + '\n'
    );
    const prefix =
      '2026-09-05 22:00:00.000|1.1|Info|push-notifications|Got notification | ChatMessageReceived\n';
    fs.writeFileSync(
      path.join(folder, 'push-notifications_000.log'),
      prefix +
        JSON.stringify(
          { eventId: 'event-' + name, message: { type, dt, templateId: id + ' ' + suffix } },
          null,
          2
        ) +
        '\n'
    );
  }
  const history = await scanQuestHistory(dir);
  assert.equal(history.notificationFiles, 5);
  assert.equal(history.ignoredFiles, 0);
  assert.equal(history.events.length, 5);
  const store = new Store(path.join(dir, 'data')),
    summary = store.applyQuestHistory(history.events, 600000);
  assert.equal(store.data.profiles.pvp.quests[questA], 'completed');
  assert.equal(store.data.profiles.seasonal.quests[questA], 'active');
  assert.equal(store.data.profiles.seasonal.quests[questB], 'failed');
  assert.equal(summary.pvp.active, 0);
  assert.equal(summary.pvp.completed, 1);
  assert.equal(summary.seasonal.active, 1);
  assert.equal(summary.seasonal.failed, 1);
  assert.equal(summary.pvp.changed, 1);
  assert.equal(summary.seasonal.changed, 2);
  assert.equal(store.data.profiles.seasonal.questSync.lastScanAt, 600000);
  assert.equal(summary.seasonal.changes.length, 2);
  assert.equal(store.data.profiles.seasonal.questSync.history.length, 2);
  const repeated = store.applyQuestHistory(history.events, 700000);
  assert.equal(repeated.pvp.changed, 0);
  assert.equal(repeated.seasonal.changed, 0);
  assert.equal(store.data.profiles.pvp.questSync.lastScanAt, 700000);
  assert.equal(store.data.profiles.seasonal.questSync.history.length, 2);
});
test('observer skips old screenshots, reads a new filename, preserves game files', async t => {
  const dir = fixture(t),
    screens = path.join(dir, 'screens'),
    logs = path.join(dir, 'logs');
  fs.mkdirSync(screens);
  fs.mkdirSync(logs);
  const old = path.join(screens, '2026-09-04[16-54]_1, 2, 3.png');
  fs.writeFileSync(old, 'DO NOT READ OR WRITE THIS IMAGE');
  const log = path.join(logs, 'application.log');
  fs.writeFileSync(log, 'x Location: bigmap,\nx|application|GameStarted:\n');
  const before = [hash(old), hash(log)];
  const o = new Observer();
  t.after(() => o.stop());
  await o.start({ screenshots: screens, logs });
  assert.equal(o.state.position, null);
  assert.equal(o.state.map, 'customs');
  assert.equal(o.state.connected, true);
  fs.writeFileSync(path.join(screens, shot), 'not an image; filename alone is sufficient');
  await o.scan();
  assert.equal(o.state.position.x, 178.07);
  assert.equal(o.state.position.map, 'customs');
  assert.equal(o.state.screenshotCount, 2);
  assert.deepEqual([hash(old), hash(log)], before);
});
test('raid end clears last position; new screenshots cannot inherit ended map', async t => {
  const dir = fixture(t),
    log = path.join(dir, 'application.log');
  fs.writeFileSync(log, 'x Location: bigmap,\nx|application|GameStarted:\n');
  const o = new Observer();
  t.after(() => o.stop());
  await o.start({ screenshots: dir, logs: dir });
  fs.writeFileSync(path.join(dir, shot), 'fixture');
  await o.scan();
  assert.equal(o.state.position.map, 'customs');
  fs.appendFileSync(log, 'x UserMatchOver\n');
  await o.scan();
  assert.equal(o.state.position, null);
  fs.writeFileSync(path.join(dir, shot.replace('(0)', '(1)')), 'fixture');
  await o.scan();
  assert.equal(o.state.position.map, null);
});
test('new screenshot with missing logs has no assumed map', async t => {
  const dir = fixture(t),
    o = new Observer();
  t.after(() => o.stop());
  await o.start({ screenshots: dir, logs: '' });
  fs.writeFileSync(path.join(dir, shot), 'fixture');
  await o.scan();
  assert.equal(o.state.position.map, null);
});
test('incomplete log line is carried into the next read', async t => {
  const dir = fixture(t),
    log = path.join(dir, 'application.log');
  fs.writeFileSync(log, 'x Location: big');
  const o = new Observer();
  t.after(() => o.stop());
  await o.start({ screenshots: '', logs: dir });
  assert.equal(o.state.map, null);
  fs.appendFileSync(log, 'map,\n');
  await o.scan();
  assert.equal(o.state.map, 'customs');
});
test('reconnecting skips existing images and does not retain a fix', async t => {
  const dir = fixture(t),
    o = new Observer();
  t.after(() => o.stop());
  await o.start({ screenshots: dir, logs: '' });
  fs.writeFileSync(path.join(dir, shot), 'fixture');
  await o.scan();
  assert.ok(o.state.position);
  await o.start({ screenshots: dir, logs: '' });
  assert.equal(o.state.position, null);
});
test('deleted or unavailable folder is reported without crashing', async t => {
  const dir = fixture(t),
    o = new Observer();
  t.after(() => o.stop());
  await o.start({ screenshots: path.join(dir, 'missing'), logs: '' });
  assert.equal(o.state.connected, false);
  assert.match(o.state.error, /unavailable/);
});
test('progress survives restart and PvP, PvE and Seasonal remain isolated', t => {
  const dir = fixture(t),
    s = new Store(dir);
  s.data.profiles.pvp.quests.example = 'completed';
  s.write();
  const restarted = new Store(dir);
  assert.equal(restarted.data.profiles.pvp.quests.example, 'completed');
  assert.equal(restarted.data.profiles.pve.quests.example, undefined);
  assert.equal(restarted.data.profiles.seasonal.quests.example, undefined);
  assert.equal(restarted.error, null);
});
test('log quest events persist once with their source and profile', t => {
  const dir = fixture(t),
    s = new Store(dir),
    event = {
      id: '665eec1f5e47a79f8605565a',
      status: 'completed',
      eventId: 'evt',
      observedAt: 1788552000000
    };
  assert.equal(s.applyQuestEvent('pve', event), true);
  assert.equal(s.applyQuestEvent('pve', event), false);
  const restarted = new Store(dir);
  assert.equal(restarted.data.profiles.pve.quests[event.id], 'completed');
  assert.equal(restarted.data.profiles.pve.questSources[event.id], 'logs');
  assert.equal(restarted.data.profiles.pve.questSync.seenEvents.length, 1);
  assert.equal(restarted.data.profiles.pve.questSync.history.length, 1);
  assert.equal(restarted.data.profiles.pvp.quests[event.id], undefined);
});
test('quest visibility and legacy raid fields survive restart', t => {
  const dir = fixture(t),
    s = new Store(dir),
    p = s.data.profiles.seasonal;
  p.raidHidden.shoreline = ['quest-a'];
  p.raidChecklist.shoreline = { 'key:Room 306': true };
  p.raidPlans.shoreline = { role: 'scav', spawn: 'north' };
  s.write();
  const restarted = new Store(dir),
    saved = restarted.data.profiles.seasonal;
  assert.deepEqual(saved.raidHidden.shoreline, ['quest-a']);
  assert.equal(saved.raidChecklist.shoreline['key:Room 306'], true);
  assert.deepEqual(saved.raidPlans.shoreline, { role: 'scav', spawn: 'north' });
  assert.ok(Array.isArray(saved.questSync.history));
});
test('legacy extract-name preference migrates to PMC and Scav subcategories', t => {
  const dir = fixture(t),
    s = new Store(dir);
  s.data.settings.mapLayers = {
    extracts: true,
    scavs: false,
    transits: false,
    landmarks: true,
    extractNames: true
  };
  s.write();
  const restarted = new Store(dir);
  assert.equal(restarted.data.settings.mapLayers.pmcExtractNames, true);
  assert.equal(restarted.data.settings.mapLayers.scavExtractNames, true);
  assert.equal(restarted.data.settings.mapLayers.transitNames, false);
  assert.equal(restarted.data.settings.mapLayers.labsKeycards, true);
  assert.equal(restarted.data.settings.mapLayers.labsKeycardNames, false);
});
test('a Tasks row picks the quest it names, digits and all', () => {
  /* Measured on a real Tasks screenshot, the old matcher got both halves wrong
     at once.

     It rewarded containment with the ratio of the two lengths, and a row of that
     table is the name plus Location, Status and Progress - so a perfect hit on
     "The Tarkov Shooter - Part 7" scored 27 characters over about a hundred and
     fell under every threshold. Then its word-overlap branch dropped words of
     two characters or fewer, which is where the part number lives, so Parts 1
     through 6 each scored 1.00 against the row that says Part 7.

     The right quest scored 0.27 and six wrong ones scored 1.00. */
  const quests = [1, 2, 6, 7].map(n => ({
    id: 'shooter-' + n,
    name: 'The Tarkov Shooter - Part ' + n,
    objectives: []
  }));
  quests.push({ id: 'reserve', name: 'Reserve', objectives: [] });
  quests.push({ id: 'import', name: 'Import', objectives: [] });
  quests.push({ id: 'tarkov-import', name: 'The Tarkov Import', objectives: [] });

  const row = 'x ) The Tarkov Shooter - Part 7    Any location   activel   0%';
  const matches = parseTaskOcr(row, quests, []);
  assert.equal(matches.length, 1, 'one row is one quest');
  assert.equal(matches[0].questId, 'shooter-7');
  assert.equal(matches[0].confidence, 1);

  /* And the other half of it: 73 quests have one-word names, so a row naming a
     quest on Reserve contains the quest "Reserve" as surely as it contains the
     quest it is about. The longest name explains the most of the row. */
  const collide = parseTaskOcr('x The Tarkov Import      Reserve     active!    83%', quests, []);
  assert.equal(collide.length, 1);
  assert.equal(collide[0].questId, 'tarkov-import');

  /* A character lost to the OCR should not lose the quest. */
  const slip = parseTaskOcr('x  Bulshit    Lighthouse   active!   0%', [
    { id: 'bs', name: 'Bullshit', objectives: [] }
  ]);
  assert.equal(slip.length, 1);
  assert.ok(slip[0].confidence > 0.8, 'a one-letter slip still scores well');
});
test('objective targets and reviewed OCR preserve partial counters', () => {
  const objective = {
      id: 'objective-a',
      description: 'Eliminate 3 PMCs on Shoreline',
      details: ['Required count: 3']
    },
    quest = { id: 'quest-a', name: 'Test Drive', objectives: [objective] };
  assert.equal(objectiveTarget(objective), 3);
  /* The row carries its status, because every row of the Tasks table does and
     the parser now requires it: a line with no status is a heading, a footer
     or the stash panel beside the table, and treating those as rows is what
     matched a quest called Documents against the task-items caption. */
  const matches = parseTaskOcr(
    'TEST DRIVE  Shoreline  active!  66%\nEliminate 3 PMCs on Shoreline 2 / 3',
    [quest],
    ['quest-a']
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].rowActive, true);
  assert.equal(matches[0].percent, 66);
  // and a line with no status is not a row at all
  assert.equal(
    parseTaskOcr('TEST DRIVE\nEliminate 3 PMCs on Shoreline 2 / 3', [quest], ['quest-a']).length,
    0
  );
  assert.deepEqual(
    { ...matches[0].objectives[0], confidence: undefined },
    {
      id: 'objective-a',
      description: objective.description,
      value: 2,
      target: 3,
      confirmed: false,
      confidence: undefined
    }
  );
  assert.ok(matches[0].objectives[0].confidence > 0.8);
});
test('new local profile fields and raid history survive restart', t => {
  const dir = fixture(t),
    store = new Store(dir),
    p = store.data.profiles.pvp;
  assert.deepEqual(p.objectiveProgress, {});
  assert.deepEqual(p.customMarkers, {});
  assert.deepEqual(p.favorites, []);
  assert.equal(store.data.settings.itemValueThreshold, 15000);
  store.recordRaidEvent('pvp', {
    type: 'start',
    id: 'raid-1',
    map: 'shoreline',
    role: 'pmc',
    at: 100,
    questIds: ['quest-a']
  });
  store.recordRaidEvent('pvp', { type: 'end', at: 200, outcome: 'unknown' });
  store.recordRaidEvent('pvp', { type: 'outcome', id: 'raid-1', outcome: 'survived' });
  const restarted = new Store(dir),
    raid = restarted.data.profiles.pvp.raidHistory[0];
  assert.equal(raid.id, 'raid-1');
  assert.equal(raid.status, 'ended');
  assert.equal(raid.startedAt, 100);
  assert.equal(raid.endedAt, 200);
  assert.equal(raid.outcome, 'survived');
});
test('observer emits identified quest notifications from selected logs', async t => {
  const dir = fixture(t),
    appLog = path.join(dir, 'application.log'),
    notice = path.join(dir, 'push-notifications_000.log');
  fs.writeFileSync(appLog, 'x|application|Session mode: Pve\n');
  fs.writeFileSync(
    notice,
    '2026-09-05 22:00:00.000|1.1|Info|push-notifications|Got notification | ChatMessageReceived\n' +
      JSON.stringify(
        {
          eventId: 'live-event',
          message: {
            type: 10,
            dt: 1788552000,
            templateId: '665eec1f5e47a79f8605565a startedMessageText'
          }
        },
        null,
        2
      ) +
      '\n'
  );
  const o = new Observer(),
    events = [];
  t.after(() => o.stop());
  o.on('quest', event => events.push(event));
  await o.start({ screenshots: '', logs: dir });
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'active');
  assert.equal(events[0].mode, 'pve');
  assert.equal(o.state.logsConnected, true);
  assert.ok(o.state.logSession);
  assert.ok(o.state.logFileCount >= 2);
  await o.scan();
  assert.equal(events.length, 1);
});
test('observer keeps quest notifications in their own PvP and Seasonal sessions', async t => {
  const dir = fixture(t),
    quest = '665eec1f5e47a79f8605565a',
    events = [];
  for (const [folder, mode, eventId] of [
    ['01-pvp', 'Pvp', 'pvp-event'],
    ['02-season', 'PvpSeason', 'season-event']
  ]) {
    const target = path.join(dir, folder);
    fs.mkdirSync(target);
    fs.writeFileSync(
      path.join(target, 'application_000.log'),
      'x|application|Session mode: ' + mode + '\n'
    );
    fs.writeFileSync(
      path.join(target, 'push-notifications_000.log'),
      '2026-09-05 22:00:00.000|1.1|Info|push-notifications|Got notification | ChatMessageReceived\n' +
        JSON.stringify(
          {
            eventId,
            message: { type: 10, dt: 1788552000, templateId: quest + ' startedMessageText' }
          },
          null,
          2
        ) +
        '\n'
    );
  }
  const observer = new Observer();
  t.after(() => observer.stop());
  observer.on('quest', event => events.push(event));
  await observer.start({ screenshots: '', logs: dir });
  assert.deepEqual(events.map(event => [event.eventId, event.mode]).sort(), [
    ['pvp-event', 'pvp'],
    ['season-event', 'seasonal']
  ]);
});
test('malformed progress is preserved as a recovery file before writing', t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'progress.json'), '{bad');
  const s = new Store(dir);
  assert.ok(s.error);
  s.write();
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('progress.json.recovery-')));
});
test('packaged renderer blocks network and hover scan avoids game-process or mouse-hook APIs', () => {
  // Every main-process source, not only main.js. The hotkey pipeline and the
  // OCR worker moved into modules of their own, and a check that reads one
  // file would have gone on passing while asserting nothing about either -
  // including the clause below that is the whole reason this test exists.
  // Read off the disk rather than listed, so a new main-process or library
  // module is covered the day it is written. The clause at the bottom of this
  // test is the one that matters, and a file nobody added to a list is a file
  // it was not asserting anything about.
  const mainSources = ['main', 'lib'].flatMap(dir =>
    fs
      .readdirSync(path.join(import.meta.dirname, '..', dir))
      .filter(name => /\.(js|cjs)$/.test(name))
      .map(name => [
        dir + '/' + name,
        fs.readFileSync(path.join(import.meta.dirname, '..', dir, name), 'utf8')
      ])
  );
  assert.ok(mainSources.length >= 10, 'expected to find the main-process and library sources');
  const main = mainSources.map(([, text]) => text).join('\n');
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /cancel:\s*true/);
  assert.match(main, /refreshQuestLogs\(\)/);
  assert.match(main, /logRefresh/);
  assert.match(main, /raid-preferences/);
  assert.match(main, /import-catalog/);
  assert.match(main, /item-value-settings/);
  assert.match(main, /ITEM_HOTKEY\s*=\s*'Shift\+F8'/);
  assert.match(main, /desktopCapturer/);
  assert.match(main, /getCursorScreenPoint/);
  assert.match(main, /\.crop\(/);
  assert.match(main, /captureCursorRegions/);
  assert.match(main, /width:\s*320,\s*height:\s*220,\s*scale:\s*3/);
  assert.match(main, /tessedit_pageseg_mode/);
  assert.match(main, /clearInventoryMatch/);
  // Named per file, so a failure says which one reached for it.
  for (const [name, text] of mainSources)
    assert.doesNotMatch(
      text,
      /sendInput|OpenProcess|ReadProcessMemory|writeProcessMemory|uiohook|SetWindowsHookEx|mouse_event/i,
      name + ' reaches for game memory, an input hook or synthetic input'
    );
});
test('complete quest catalogs are bundled and the UI does not force a Customs-only list', () => {
  for (const [file, minimum] of [
    ['quests.json', 500],
    ['quests-pve.json', 500],
    ['quests-seasonal.json', 480]
  ]) {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '../app/data', file), 'utf8')
    ).quests;
    assert.ok(catalog.length >= minimum, `${file} should contain the complete snapshot`);
    assert.equal(
      new Set(catalog.map(q => q.id)).size,
      catalog.length,
      `${file} quest IDs must be unique`
    );
    assert.ok(
      catalog.every(q => q.id && q.name && Array.isArray(q.mapIds) && Array.isArray(q.objectives))
    );
    const maps = new Set(
      JSON.parse(
        fs.readFileSync(path.join(import.meta.dirname, '../app/data/maps.json'), 'utf8')
      ).map(map => map.id)
    );
    assert.ok(
      catalog.every(q => q.mapIds.every(id => maps.has(id))),
      `${file} map IDs must exist`
    );
    assert.ok(
      catalog
        .flatMap(q => q.objectives)
        .flatMap(o => [
          ...(o.zones || []).map(z => z.position),
          ...(o.possibleLocations || []).flatMap(z => z.positions || [])
        ])
        .every(p => [p.x, p.y, p.z].every(Number.isFinite)),
      `${file} map coordinates must be finite`
    );
  }
  const renderer = rendererSource();
  const html = fs.readFileSync(path.join(import.meta.dirname, '../app/index.html'), 'utf8');
  assert.match(renderer, /assignQuests\(\s*\[\.\.\.allData\.quests,\s*\.\.\.extras\]\.sort/);
  assert.doesNotMatch(
    renderer,
    /quests\s*=\s*allData\.quests\.filter\(q\s*=>\s*q\.mapIds\.includes\('customs'\)\)/
  );
  assert.match(html, /id="map-filter"/);
  assert.match(html, /value="open" selected/);
  assert.match(html, /value="story"/);
  const pathFilter = html.match(/<select id="path-filter"[\s\S]*?<\/select>/)[0];
  assert.doesNotMatch(pathFilter, /value="battlepass"/);
  assert.match(html, /TARKOV<b>EYES<\/b>/);
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(
    match => match[1]
  );
  // The ORDER is the cascade. app.css was split into these eight without
  // moving a byte, and later rules are meant to win, so a reordered link list
  // is a silent restyling of the whole application. Battle Pass stays last.
  assert.deepEqual(
    sheets,
    [
      'css/tokens.css',
      'css/legacy.css',
      'css/layout.css',
      'css/map.css',
      'css/rails.css',
      'css/type.css',
      'css/corrections.css',
      'css/features.css',
      'battlepass.css'
    ],
    'the renderer loads the stylesheet eras in order, with the Battle Pass layer last'
  );
  for (const sheet of sheets)
    assert.ok(
      fs.existsSync(path.join(import.meta.dirname, '../app', sheet)),
      sheet + ' is bundled'
    );
  // tokens.css is where the palette is declared. Exactly one later file
  // overrides a token, and it is on purpose: the monochrome pass turned
  // --gold into the brightest neutral (#e6e8ea) and kept the name rather than
  // rewriting the thousand elements that reference it. That override wins
  // because map.css loads after tokens.css, so the two must stay in that
  // order - and a THIRD place defining the palette is how a palette stops
  // being one, which is what this names.
  const tokens = fs.readFileSync(path.join(import.meta.dirname, '../app/css/tokens.css'), 'utf8');
  assert.match(tokens, /--gold: #e9b969/, 'tokens.css declares the palette');
  const redefines = sheets.filter(
    sheet =>
      sheet !== 'css/tokens.css' &&
      /^\s*--gold:/m.test(fs.readFileSync(path.join(import.meta.dirname, '../app', sheet), 'utf8'))
  );
  assert.deepEqual(redefines, ['css/map.css'], 'only the monochrome pass may override a token');
  assert.ok(
    sheets.indexOf('css/tokens.css') < sheets.indexOf('css/map.css'),
    'the override only wins while tokens.css loads first'
  );
  for (const retired of [
    'app.css',
    'styles.css',
    'v02.css',
    'v03.css',
    'v04.css',
    'v05.css',
    'field-journal.css'
  ])
    assert.ok(
      !fs.existsSync(path.join(import.meta.dirname, '../app', retired)),
      retired + ' was split into app/css and must not come back'
    );
  assert.match(html, /id="refresh-logs"/);
  assert.match(html, /id="activity-dialog"/);
  assert.match(html, /id="import-catalog"/);
  assert.match(renderer, /bridge\.refreshLogs\(\)/);
  assert.match(renderer, /function renderMyRaid/);
  assert.match(renderer, /questMarkerMeta/);
  assert.match(renderer, /visibleRaidQuests/);
  assert.match(renderer, /raidPreferences/);
  for (const id of [
    'loot-source-status',
    'loot-essentials',
    'scan-tasks',
    'items-button',
    'items-dialog',
    'refresh-prices',
    'item-search',
    'item-hotkey-enabled',
    'item-hotkey-status',
    'item-value-threshold',
    'log-diagnostics',
    'dashboard-button',
    'add-marker',
    'marker-dialog',
    'marker-form',
    'marker-name',
    'marker-note',
    'save-marker',
    'layer-custom',
    'layer-lab-keycards',
    'layer-lab-keycard-labels',
    'keycard-doors',
    'keycard-labels',
    'path-filter',
    'export-backup',
    'import-backup',
    'quick-find',
    'command-dialog',
    'command-search',
    'command-results',
    'toggle-details',
    'focus-map'
  ])
    assert.match(html, new RegExp('id="' + id + '"'));
  for (const preset of ['raid', 'valuables', 'clean'])
    assert.match(html, new RegExp('data-layer-preset="' + preset + '"'));
  assert.match(html, /No Inspect needed/);
  assert.doesNotMatch(html, /id="scan-item"|Choose screenshot/);
  assert.match(renderer, /function saveMarkerEditor/);
  assert.doesNotMatch(renderer, /window\.prompt/);
  assert.match(renderer, /function centeredView/);
  assert.doesNotMatch(renderer, /w:300,h:180/);
  assert.match(renderer, /function showQuestCluster/);
  assert.match(renderer, /function renderLogDiagnostics/);
  assert.match(renderer, /itemValueThreshold/);
  assert.doesNotMatch(
    renderer,
    /orderedRaidQuests|function renderRoute|routeMode|START AREA|ROUTE ORDER/
  );
  assert.match(renderer, /function renderDashboard/);
  assert.match(renderer, /function runItemScan/);
  assert.match(renderer, /objective-counter/);
  assert.match(renderer, /inspectCatalog/);
  for (const fn of [
    'commandEntries',
    'openCommandPalette',
    'applyLayerPreset',
    'setMapFocus',
    'setDetailsCollapsed',
    'revealMapSearch'
  ])
    assert.match(renderer, new RegExp('function ' + fn));
  assert.match(renderer, /e\.ctrlKey\s*\|\|\s*e\.metaKey/);
  assert.match(renderer, /e\.key\.toLowerCase\(\)\s*===\s*['"]f['"]/);
  assert.doesNotMatch(html, /POST-RAID REVIEW|raid-review-dialog/);
  assert.doesNotMatch(renderer, /openRaidReview|pendingRaidReview/);
  assert.match(renderer, /function applyQuestPathFilter/);
  assert.match(renderer, /q\.kappaRequired/);
  assert.match(renderer, /q\.lightkeeperRequired/);
  assert.match(html, /class="quest-filter-panel"/);
  assert.match(html, /id="filter-summary"/);
});
test('EFT 1.1.5 Trust but Verify quest is bundled for Labs in every profile catalog', () => {
  for (const file of ['quests.json', 'quests-pve.json', 'quests-seasonal.json']) {
    const quest = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '../app/data', file), 'utf8')
    ).quests.find(item => item.id === '6a880acc9216d0f5aa078305');
    assert.ok(quest, file + ' quest');
    assert.equal(quest.name, 'To the Light - Trust but Verify');
    assert.deepEqual(quest.mapIds, ['the-lab']);
    assert.equal(quest.objectives.length, 2);
    assert.ok(quest.objectives.every(objective => objective.mapIds.includes('the-lab')));
  }
  const main = fs.readFileSync(path.join(import.meta.dirname, '../main/main.js'), 'utf8');
  assert.doesNotMatch(main, /const known=history\.events\.filter/);
  assert.doesNotMatch(main, /if\(!ids\.has\(event\.id\)\)return/);
  assert.match(main, /unknownQuestIds/);
});
test('every declared map has bundled artwork, POIs and a selectable location', () => {
  const maps = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/maps.json'), 'utf8')
  );
  assert.equal(maps.length, 13);
  for (const map of maps) {
    const assets = [map.baseAsset, ...map.floors.map(floor => floor.asset).filter(Boolean)];
    for (const asset of assets)
      assert.ok(
        fs.existsSync(
          path.join(import.meta.dirname, '../app/assets', asset.path.replace(/^\/+/, ''))
        ),
        `${map.id}: ${asset.path}`
      );
    assert.ok(
      fs.existsSync(path.join(import.meta.dirname, '../app/data/poi', map.id + '.json')),
      `${map.id}: POI bundle`
    );
  }
  const html = fs.readFileSync(path.join(import.meta.dirname, '../app/index.html'), 'utf8'),
    renderer = rendererSource();
  assert.match(html, /id="location"/);
  assert.match(renderer, /async function switchMap/);
  assert.match(renderer, /state\.position\.map/);
});
test('every declared map has a validated loot layer and every marker icon is bundled', () => {
  const maps = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '../app/data/maps.json'), 'utf8')
    ),
    checkedIcons = new Set();
  let total = 0;
  for (const map of maps) {
    const file = path.join(import.meta.dirname, '../app/data/loot', map.id + '.json');
    assert.ok(fs.existsSync(file), map.id + ': loot snapshot');
    const loot = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(loot.schemaVersion, 3);
    assert.equal(loot.mapId, map.id);
    assert.match(loot.source, /^https:\/\/json\.tarkov\.dev\/regular\/maps$/);
    total += (loot.containers?.length || 0) + (loot.loose?.length || 0);
    const [[x1, z1], [x2, z2]] = map.bounds,
      minX = Math.min(x1, x2) - 2,
      maxX = Math.max(x1, x2) + 2,
      minZ = Math.min(z1, z2) - 2,
      maxZ = Math.max(z1, z2) + 2;
    for (const [x, y, z, type] of loot.containers || []) {
      assert.ok([x, y, z].every(Number.isFinite), map.id + ': finite container coordinates');
      assert.ok(
        x >= minX && x <= maxX && z >= minZ && z <= maxZ,
        map.id + ': container in map bounds'
      );
      const meta = loot.containerTypes[type];
      assert.ok(
        meta?.label && meta?.icon && loot.containerCategories[meta.category],
        map.id + ': categorized container metadata'
      );
      checkedIcons.add(path.join(import.meta.dirname, '../app/assets/loot/containers', meta.icon));
    }
    for (const [x, y, z, ids, categories] of loot.loose || []) {
      assert.ok([x, y, z].every(Number.isFinite), map.id + ': finite loose-loot coordinates');
      assert.ok(
        x >= minX && x <= maxX && z >= minZ && z <= maxZ,
        map.id + ': loose loot in map bounds'
      );
      assert.ok(
        Array.isArray(ids) && ids.length && Array.isArray(categories) && categories.length,
        map.id + ': categorized loose-loot items'
      );
      for (const id of ids) {
        assert.ok(
          loot.items[id]?.name && loot.categories[loot.items[id].categoryKey],
          map.id + ': loose-loot item metadata'
        );
        assert.ok(
          Array.isArray(loot.items[id].categoryKeys) &&
            loot.items[id].categoryKeys.includes(loot.items[id].categoryKey),
          map.id + ': primary category remains part of multi-filter metadata'
        );
        checkedIcons.add(path.join(import.meta.dirname, '../app/assets/loot/items', id + '.webp'));
      }
    }
    for (const meta of Object.values(loot.categories))
      checkedIcons.add(path.join(import.meta.dirname, '../app/assets/loot/categories', meta.icon));
  }
  assert.ok(total > 11000, 'complete tarkov.dev loot snapshot');
  for (const icon of checkedIcons)
    assert.ok(
      fs.existsSync(icon) && fs.statSync(icon).size > 100,
      'bundled loot icon: ' + path.basename(icon)
    );
});
test('quest route filters have current source flags and meaningful catalog coverage', () => {
  for (const file of ['quests.json', 'quests-pve.json', 'quests-seasonal.json']) {
    const quests = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '../app/data', file), 'utf8')
    ).quests;
    assert.ok(quests.filter(q => q.kappaRequired).length >= 10, file + ': Kappa flags');
    assert.ok(quests.filter(q => q.lightkeeperRequired).length >= 7, file + ': Lightkeeper flags');
    assert.ok(
      quests.some(q => q.traderName === 'Lightkeeper'),
      file + ': Lightkeeper quest chain'
    );
  }
});
test('story chapters and Battle Pass documents are bundled as separate tracks', () => {
  const data = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/special-tracks.json'), 'utf8')
  );
  assert.equal(data.storyChapterCount, 10);
  assert.ok(data.storyObjectiveCount >= 380);
  assert.ok(data.battlePassItemCount >= 9);
  assert.equal(data.quests.filter(q => q.category === 'story').length, 10);
  assert.equal(data.quests.filter(q => q.category === 'battlepass').length, 1);
  assert.ok(
    data.quests
      .filter(q => q.category === 'story')
      .every(q => q.sourceQuestIds.length && q.objectives.length)
  );
});

test('map artwork waits for the image to load, not for a decoded frame', () => {
  const renderer = rendererSource();
  // image.decode() never settles while the window is hidden or fully occluded,
  // which stranded the image-based maps on "Loading ..." whenever the map changed
  // with the app in the background. onload resolves either way.
  const code = renderer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\.decode\(\)/, 'the renderer must not await image.decode()');
  assert.match(renderer, /function loadImage\(/);
  assert.match(renderer, /image\.onload\s*=/);
  assert.match(renderer, /image\.onerror\s*=/);
  assert.match(renderer, /const image = await loadImage\(path\)/);
  const maps = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/maps.json'), 'utf8')
  );
  const bitmap = maps.filter(map => map.baseAsset.type === 'image').map(map => map.id);
  assert.deepEqual(
    bitmap.sort(),
    ['icebreaker', 'the-labyrinth'],
    'the maps that depend on this path'
  );
});
test('every bundled hazard zone can be drawn, and the renderer wires the layer', () => {
  const renderer = rendererSource();
  const html = fs.readFileSync(path.join(import.meta.dirname, '../app/index.html'), 'utf8');
  const main = fs.readFileSync(path.join(import.meta.dirname, '../main/main.js'), 'utf8');
  assert.match(renderer, /function renderHazards\(/);
  assert.match(html, /<g id="hazards">/, 'the map has a layer to draw zones into');
  const types = ['minefield', 'sniper', 'mortar', 'hazard'];
  for (const type of types) {
    assert.match(html, new RegExp('id="layer-hazard-' + type + '"'), type + ' has a control');
    assert.match(
      main,
      new RegExp("'hazard" + type[0].toUpperCase() + type.slice(1) + "'"),
      type + ' is an accepted saved layer'
    );
  }
  const maps = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/maps.json'), 'utf8')
  );
  const seen = new Map();
  let outlines = 0,
    total = 0;
  for (const map of maps) {
    const file = path.join(import.meta.dirname, '../app/data/poi', map.id + '.json');
    if (!fs.existsSync(file)) continue;
    for (const poi of JSON.parse(fs.readFileSync(file, 'utf8')).pois) {
      if (poi.kind !== 'hazard') continue;
      total++;
      const type = poi.hazardType || 'hazard';
      assert.ok(types.includes(type), map.id + ' has an unknown hazard type: ' + type);
      seen.set(type, (seen.get(type) || 0) + 1);
      assert.ok(
        Number.isFinite(poi.position?.x) && Number.isFinite(poi.position?.z),
        map.id + ' hazard without a position'
      );
      for (const corner of poi.outline || []) {
        assert.ok(
          Number.isFinite(corner.x) && Number.isFinite(corner.z),
          map.id + ' hazard outline corner is not a point'
        );
      }
      if ((poi.outline || []).length > 2) outlines++;
    }
  }
  assert.ok(total >= 600, 'the bundled maps still carry their hazard zones (' + total + ')');
  assert.equal(outlines, total, 'every hazard zone has a polygon to draw');
  assert.ok(
    seen.get('minefield') >= 500 && seen.get('sniper') >= 50,
    'minefields and sniper zones are present'
  );
});
test('landmarks are derived for the maps the hand-placed list never covered', () => {
  const renderer = rendererSource();
  assert.match(renderer, /function derivedLandmarks\(/);
  assert.match(
    renderer,
    /const internalLabel = \/_\|\\d\|\[a-z\]\[A-Z\]\/;/,
    'the camelCase test must stay case-sensitive'
  );
  assert.match(renderer, /const vagueLabel = \/\\b\(spawn\|ambush\|snipe\|zone\|any\)\\b\/i;/);
  assert.ok(
    ![...renderer].some(ch => {
      const code = ch.charCodeAt(0);
      return code < 9 || code === 11 || code === 12 || (code >= 14 && code < 32);
    }),
    'no control characters may leak into the renderer source'
  );
  // The same rules the renderer applies, so a POI refresh that renames zones to
  // internal identifiers fails here instead of captioning the map with them.
  const internalLabel = /_|\d|[a-z][A-Z]/,
    vagueLabel = /\b(spawn|ambush|snipe|zone|any)\b/i;
  const floorLabel = /^(first|second|third|fourth|ground)\s+(floor|level)$|^basement$/i;
  const named = mapId => {
    const file = path.join(import.meta.dirname, '../app/data/poi', mapId + '.json');
    if (!fs.existsSync(file)) return [];
    const out = new Set();
    for (const poi of JSON.parse(fs.readFileSync(file, 'utf8')).pois) {
      let label = null;
      if (poi.kind === 'boss-zone')
        label = poi.name.includes('·') ? poi.name.split('·').pop().trim() : null;
      else if (poi.kind === 'btr') label = poi.name;
      if (
        !label ||
        label.length < 3 ||
        internalLabel.test(label) ||
        vagueLabel.test(label) ||
        floorLabel.test(label)
      )
        continue;
      out.add(label.toUpperCase());
    }
    return [...out];
  };
  for (const [mapId, least] of [
    ['streets-of-tarkov', 8],
    ['woods', 10],
    ['lighthouse', 8],
    ['shoreline', 5],
    ['interchange', 4]
  ])
    assert.ok(
      named(mapId).length >= least,
      mapId + ' should still yield place names, got ' + named(mapId).length
    );
  for (const mapId of ['terminal', 'the-labyrinth'])
    assert.equal(
      named(mapId).length,
      0,
      mapId + ' has only internal zone names and must stay unlabelled'
    );
  const woods = named('woods');
  assert.ok(
    woods.includes('SAWMILL') && woods.includes('OLD SAWMILL'),
    'Sawmill and Old Sawmill are different places and both belong on the map'
  );
  for (const mapId of ['customs', 'woods', 'streets-of-tarkov', 'lighthouse'])
    for (const label of named(mapId))
      assert.ok(
        !internalLabel.test(label) && !vagueLabel.test(label),
        mapId + ' kept an internal-looking label: ' + label
      );
});
test('every locked door resolves to a key name the map can print', () => {
  const renderer = rendererSource();
  const html = fs.readFileSync(path.join(import.meta.dirname, '../app/index.html'), 'utf8');
  const main = fs.readFileSync(path.join(import.meta.dirname, '../main/main.js'), 'utf8');
  assert.match(renderer, /function renderDoors\(/);
  assert.match(
    renderer,
    /function doorsForKeyName\(/,
    'the raid kit needs to find doors from a key name'
  );
  assert.match(renderer, /function keyDoorButton\(/);
  assert.match(html, /<g id="door-markers">/);
  assert.match(html, /id="layer-doors"/);
  assert.match(main, /'lockedDoors'/, 'the saved layer key is accepted by the main process');
  const keys = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/keys.json'), 'utf8')
  ).keys;
  const cards = new Set(
    JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '../app/data/lab-keycards.json'), 'utf8')
    ).keycards.map(card => card.id)
  );
  const maps = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/maps.json'), 'utf8')
  );
  let doors = 0,
    labKeycardDoors = 0;
  for (const map of maps) {
    const file = path.join(import.meta.dirname, '../app/data/poi', map.id + '.json');
    if (!fs.existsSync(file)) continue;
    for (const poi of JSON.parse(fs.readFileSync(file, 'utf8')).pois) {
      if (poi.kind !== 'locked-door') continue;
      doors++;
      assert.ok((poi.keyIds || []).length, map.id + ' has a locked door with no key');
      for (const id of poi.keyIds) {
        assert.ok(
          keys[id] && keys[id].name,
          map.id + ' door needs key ' + id + ' which keys.json cannot name'
        );
        assert.ok(!/^[0-9a-f]{24}$/.test(keys[id].name), 'a key name must not just be an id');
      }
      if (map.id === 'the-lab' && poi.keyIds.some(id => cards.has(id))) labKeycardDoors++;
    }
  }
  assert.ok(doors >= 320, 'the bundled maps still carry their locked doors (' + doors + ')');
  assert.equal(
    labKeycardDoors,
    9,
    'Labs keycard doors stay with the keycard layer, which the door layer skips'
  );
  // Quest keys must be nameable too, or the raid kit button cannot find their doors.
  for (const file of ['quests.json', 'quests-seasonal.json']) {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '../app/data', file), 'utf8')
    );
    for (const quest of catalog.quests)
      for (const key of quest.neededKeys || [])
        if (key.id)
          assert.ok(
            keys[key.id],
            file + ': ' + quest.name + ' needs key ' + key.id + ' which keys.json cannot name'
          );
  }
});
test('switch chains resolve to the extracts and switches they operate', () => {
  const renderer = rendererSource();
  const html = fs.readFileSync(path.join(import.meta.dirname, '../app/index.html'), 'utf8');
  const main = fs.readFileSync(path.join(import.meta.dirname, '../main/main.js'), 'utf8');
  assert.match(renderer, /function renderSwitches\(/);
  assert.match(renderer, /function switchEffects\(/);
  assert.match(html, /<g id="switch-markers">/);
  assert.match(html, /id="layer-switches"/);
  assert.match(main, /'switches'/);
  const maps = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/maps.json'), 'utf8')
  );
  let switches = 0,
    effects = 0,
    toExtract = 0;
  const chained = [];
  for (const map of maps) {
    const file = path.join(import.meta.dirname, '../app/data/poi', map.id + '.json');
    if (!fs.existsSync(file)) continue;
    const pois = JSON.parse(fs.readFileSync(file, 'utf8')).pois,
      byId = new Map(pois.map(p => [p.id, p]));
    for (const poi of pois) {
      if (poi.kind !== 'switch') continue;
      switches++;
      assert.ok(poi.name && poi.name.trim(), map.id + ' has a switch with no name');
      for (const step of poi.activates || []) {
        effects++;
        const target = byId.get(step.targetId);
        assert.ok(
          target,
          map.id + ': ' + poi.name + ' operates ' + step.targetId + ' which is not in that map'
        );
        assert.ok(target.name, map.id + ': ' + poi.name + ' operates something unnamed');
        if (target.kind === 'extract') toExtract++;
        if (target.kind === 'switch' && (target.activates || []).length)
          chained.push(map.id + '/' + poi.name);
      }
    }
  }
  assert.equal(switches, 39, 'the bundled maps still carry their switches');
  assert.ok(effects >= 15, 'switch effects are still recorded (' + effects + ')');
  assert.ok(
    toExtract >= 8,
    'switches that open an extract are the useful ones (' + toExtract + ')'
  );
  assert.ok(
    chained.includes('reserve/D-2 Power Switch'),
    'the D-2 two-step chain must survive, it is what the popup explains'
  );
});
test('every trader in the catalogs has a bundled portrait, with initials as the fallback', () => {
  const renderer = rendererSource();
  assert.match(renderer, /function traderBadge\(/);
  assert.match(renderer, /function traderInitials\(/, 'tracks with no trader still need a badge');
  assert.match(
    renderer,
    /image\.onerror = \(\) => \{/,
    'a missing portrait must fall back, not leave an empty square'
  );
  const doc = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/traders.json'), 'utf8')
  );
  const referenced = new Map();
  for (const file of ['quests.json', 'quests-pve.json', 'quests-seasonal.json']) {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '../app/data', file), 'utf8')
    );
    for (const quest of catalog.quests)
      if (quest.traderId) referenced.set(quest.traderId, quest.traderName);
  }
  assert.ok(
    referenced.size >= 11,
    'the catalogs still name their traders (' + referenced.size + ')'
  );
  for (const [id, name] of referenced) {
    const entry = doc.traders[id];
    assert.ok(entry, name + ' (' + id + ') has no portrait entry');
    assert.equal(entry.name, name);
    assert.match(entry.image, /^assets\/traders\/[0-9a-f]{24}\.webp$/, name + ' portrait path');
    const file = path.join(
      import.meta.dirname,
      '../app/assets',
      entry.image.replace(/^assets\//, '')
    );
    assert.ok(fs.existsSync(file), name + ' portrait is not bundled');
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 200, name + ' portrait is suspiciously small');
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF', name + ' portrait is not a WebP');
    assert.equal(bytes.subarray(8, 12).toString(), 'WEBP', name + ' portrait is not a WebP');
  }
  // The special tracks have no trader and must keep working through the fallback.
  const tracks = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/special-tracks.json'), 'utf8')
  );
  const trackTraders = [
    ...new Set((tracks.quests || []).map(quest => quest.traderId).filter(Boolean))
  ];
  assert.ok(trackTraders.length, 'special tracks still declare a track name');
  for (const id of trackTraders)
    assert.ok(
      !doc.traders[id],
      '"' + id + '" is a track, not a trader, and must fall back to initials'
    );
});
test('keys are shown with the image the game uses', () => {
  const renderer = rendererSource();
  assert.match(renderer, /function keyImage\(/);
  assert.match(renderer, /function keyIconFor\(/);
  assert.match(
    renderer,
    /image\.onerror = \(\) => image\.replaceWith\(uiIcon\('keycard'\)\)/,
    'a missing key image must fall back to the glyph'
  );
  const keys = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/keys.json'), 'utf8')
  ).keys;
  const entries = Object.entries(keys);
  assert.ok(
    entries.length >= 190,
    'the key catalogue still covers the doors and quests (' + entries.length + ')'
  );
  let withIcon = 0;
  for (const [id, key] of entries) {
    if (!key.icon) continue;
    withIcon++;
    assert.equal(key.icon, 'assets/keys/' + id + '.webp', key.name + ' icon path');
    const file = path.join(import.meta.dirname, '../app/assets/keys', id + '.webp');
    assert.ok(fs.existsSync(file), key.name + ' icon is not bundled');
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 200, key.name + ' icon is suspiciously small');
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF', key.name + ' icon is not a WebP');
    assert.equal(bytes.subarray(8, 12).toString(), 'WEBP', key.name + ' icon is not a WebP');
  }
  assert.equal(withIcon, entries.length, 'every key in the catalogue carries its image');
  // Nothing bundled should be orphaned either.
  const onDisk = fs
    .readdirSync(path.join(import.meta.dirname, '../app/assets/keys'))
    .filter(name => name.endsWith('.webp'));
  assert.equal(onDisk.length, entries.length, 'no stray key images are bundled');
});
test('quest pictures and boss portraits are bundled and wired', () => {
  const renderer = rendererSource();
  assert.match(renderer, /questImages\[q\.id\]/, 'the brief shows the picture the game uses');
  assert.match(
    renderer,
    /hero\.onerror = \(\) => hero\.remove\(\)/,
    'a missing picture must not leave a broken image'
  );
  assert.match(renderer, /function renderBosses\(/, 'boss zones have their own layer');
  assert.match(renderer, /bossCatalog\[group\.boss\]/, 'the layer draws the portrait');
  assert.doesNotMatch(
    renderer,
    /landmarkText\([^)]*boss/,
    'a portrait must not depend on a landmark label winning its name'
  );
  const images = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/quest-images.json'), 'utf8')
  ).images;
  const bosses = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/bosses.json'), 'utf8')
  ).bosses;
  const magic = file => {
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 500, file + ' is suspiciously small');
    const webp =
      bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    const png = bytes.subarray(1, 4).toString() === 'PNG';
    assert.ok(webp || png, file + ' is not an image');
  };
  let checked = 0;
  for (const [id, relative] of Object.entries(images)) {
    assert.equal(relative, 'assets/quests/' + id + '.webp');
    const file = path.join(import.meta.dirname, '../app/assets/quests', id + '.webp');
    assert.ok(fs.existsSync(file), 'quest picture missing for ' + id);
    if (checked++ < 25) magic(file);
  }
  assert.ok(
    Object.keys(images).length >= 500,
    'the quest pictures are still bundled (' + Object.keys(images).length + ')'
  );
  // Every boss the POIs name must have a portrait, or the landmark silently loses it.
  const named = new Set();
  for (const file of fs.readdirSync(path.join(import.meta.dirname, '../app/data/poi')))
    for (const poi of JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '../app/data/poi', file), 'utf8')
    ).pois)
      if (poi.kind === 'boss-zone' && poi.bossName) named.add(poi.bossName);
  for (const name of named) {
    const entry = bosses[name];
    assert.ok(entry, 'no portrait entry for boss ' + name);
    const file = path.join(
      import.meta.dirname,
      '../app/assets',
      entry.image.replace(/^assets\//, '')
    );
    assert.ok(fs.existsSync(file), name + ' portrait is not bundled');
    magic(file);
  }
  assert.equal(
    Object.keys(bosses).length,
    named.size,
    'the boss catalogue matches the zones exactly'
  );
});
test('boss spawn chances follow the profile in play', () => {
  const renderer = rendererSource();
  assert.match(
    renderer,
    /bossSpawnRates\?\.modes\?\.\[data\.mode\]/,
    'the rate must be read for the selected mode'
  );
  assert.match(
    renderer,
    /function bossRateNote\(/,
    'the popup says which mode the figure belongs to'
  );
  const doc = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/boss-spawns.json'), 'utf8')
  );
  for (const mode of ['pvp', 'pve', 'seasonal']) assert.ok(doc.modes[mode], 'no rates for ' + mode);
  const maps = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/maps.json'), 'utf8')
  ).map(map => map.id);
  for (const [mapId, bosses] of Object.entries(doc.modes.pvp)) {
    assert.ok(maps.includes(mapId), 'rates name a map this build does not bundle: ' + mapId);
    for (const [mob, chance] of Object.entries(bosses)) {
      assert.equal(typeof mob, 'string');
      assert.ok(chance > 0 && chance <= 1, mapId + '/' + mob + ' chance out of range: ' + chance);
    }
  }
  // The whole point is that the modes differ; if a refresh collapses them the
  // app is quietly showing everyone the same number again.
  let differences = 0;
  for (const [mapId, bosses] of Object.entries(doc.modes.pvp))
    for (const [mob, chance] of Object.entries(bosses))
      if (
        doc.modes.pve[mapId]?.[mob] !== undefined &&
        Math.abs(doc.modes.pve[mapId][mob] - chance) > 0.001
      )
        differences++;
  assert.ok(
    differences >= 10,
    'PvP and PvE rates should still differ in several places, found ' + differences
  );
  assert.match(doc.notice, /Seasonal/, 'the seasonal provenance is stated');
  if (doc.seasonalSource === 'pvp')
    assert.deepEqual(
      doc.modes.seasonal,
      doc.modes.pvp,
      'a seasonal fallback must be exactly the PvP table, not an invented one'
    );
  // Every boss the zones name should be priced by the table, or the marker
  // silently falls back to the single snapshot in the POI file.
  const priced = new Set(Object.values(doc.modes.pvp).flatMap(bosses => Object.keys(bosses)));
  const zoneBosses = new Set();
  for (const file of fs.readdirSync(path.join(import.meta.dirname, '../app/data/poi')))
    for (const poi of JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, '../app/data/poi', file), 'utf8')
    ).pois)
      if (poi.kind === 'boss-zone' && poi.bossId) zoneBosses.add(poi.bossId);
  const covered = [...zoneBosses].filter(id => priced.has(id));
  assert.ok(
    covered.length >= 8,
    'the table should price most bosses the zones name (' +
      covered.length +
      ' of ' +
      zoneBosses.size +
      ')'
  );
});
test('quest events name their trader so unlisted quests can still be identified', () => {
  const core = fs.readFileSync(path.join(import.meta.dirname, '../lib/core.js'), 'utf8');
  assert.match(
    core,
    /trader: \/\^\[a-f0-9\]\{24\}\$\/i\.test/,
    'the parser reads the notification uid'
  );
  const main = fs.readFileSync(path.join(import.meta.dirname, '../main/main.js'), 'utf8');
  assert.match(
    main,
    /const unknownQuests = unknownQuestIds\.map/,
    'the scan reports details, not just ids'
  );
  assert.match(main, /unknownQuests,/, 'and returns them');
  const renderer = rendererSource();
  assert.match(renderer, /assignUnknownQuestDetails\(result\.unknownQuests/);
  assert.doesNotMatch(
    renderer,
    /newer quest/,
    'they are not newer: the logs reach back to earlier versions'
  );
  const html = fs.readFileSync(path.join(import.meta.dirname, '../app/index.html'), 'utf8');
  assert.match(html, /id="catalog-unknown"/);
  const sample =
    '2026-09-01 17:14:39.000 Got notification | ChatMessageReceived\n' +
    JSON.stringify(
      {
        eventId: 'e1',
        message: {
          uid: '6617beeaa9cfa777ca915b7c',
          type: 10,
          dt: 1788272164,
          templateId: '6a91840a740be0cff50e0310 successMessageText'
        }
      },
      null,
      1
    ) +
    '\n';
  const [event] = parseQuestNotifications(sample);
  assert.equal(event.trader, '6617beeaa9cfa777ca915b7c');
  assert.equal(event.status, 'completed');
  const traders = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../app/data/traders.json'), 'utf8')
  ).traders;
  assert.ok(
    traders[event.trader],
    'a trader id from a notification resolves to a bundled portrait'
  );
});

test('every module the main process loads is one the installed copy gets', () => {
  // A missing entry does not fail a test or a build: it crashes the installed
  // application on launch with "Cannot find module", which is what shipping
  // templates.js unlisted did, and what paths.js nearly repeated.
  //
  // The build copies main/ and lib/ as whole directories now, so the old
  // per-file lists are gone and cannot go stale. What is left to check is the
  // assumption that replaced them: that everything the entry points reach
  // really does live inside a directory the build takes.
  const read = rel => fs.readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8');
  const shipped = ['main', 'lib', 'app', 'licenses'];

  const required = new Set();
  const seen = new Set();
  const follow = rel => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const dir = path.posix.dirname(rel);
    /* The sources are ES modules now, so what binds them is an import
       specifier rather than a require call. Both shapes are matched, so this
       keeps working if anything is ever loaded the other way. */
    for (const found of read(rel).matchAll(/(?:require\('|from ')(\.[\w./-]+\.(?:js|cjs))'/g)) {
      const target = path.posix.normalize(path.posix.join(dir, found[1]));
      required.add(target);
      follow(target);
    }
  };
  follow('main/main.js');
  /* The one file that cannot be an ES module: Electron does not support ESM in
     a preload while sandbox is on, and it fails silently - the bridge is
     simply never created. Demonstrated by renaming it and watching
     window.companion go undefined. */
  follow('main/preload.cjs');
  assert.ok(required.size >= 8, 'expected the main process to load several local modules');
  for (const expected of ['lib/core.js', 'lib/items.js', 'lib/imaging.js', 'lib/appearance.js'])
    assert.ok(required.has(expected), expected + ' should still be reachable from main/main.js');

  for (const module of required) {
    assert.ok(
      shipped.includes(module.split('/')[0]),
      module + ' is loaded at runtime but sits outside every directory the build copies'
    );
    assert.ok(
      fs.existsSync(path.join(import.meta.dirname, '..', module)),
      module + ' is imported but does not exist'
    );
  }
  // and the build really does take those directories
  const sync = read('tools/release/sync-installed.js'),
    pack = read('tools/release/package.js');
  for (const dir of ['main', 'lib']) {
    assert.ok(sync.includes("'" + dir + "'"), 'sync-installed.js does not copy ' + dir + '/');
    assert.ok(pack.includes("'" + dir + "'"), 'package.js does not package ' + dir + '/');
  }
  // the entry point the installed copy will be told to run
  assert.equal(JSON.parse(read('package.json')).main, 'main/main.js');
});

test('a raid is stamped from the log line, not from when the log was read', () => {
  // This test exists because the first version of lineTime shipped with its
  // backslashes eaten by a shell quote - /^(d{4}-d{2}-d{2})/ instead of
  // /^(\d{4}-\d{2}-\d{2})/ - so it matched nothing, returned null every time,
  // and the raid timing fix silently did nothing at all. The negative cases
  // below all passed against that broken version; only the positive one fails.
  const real = '2026-09-12 00:16:56.197|1.1.5.0.47242|Info|application|GameStarted:123.67(123.67)';
  const at = lineTime(real);
  assert.ok(at, 'a real log line must yield a timestamp');
  const when = new Date(at);
  assert.equal(when.getFullYear(), 2026);
  assert.equal(when.getMonth(), 8); // September
  assert.equal(when.getDate(), 12);
  assert.equal(when.getHours(), 0);
  assert.equal(when.getMinutes(), 16);
  assert.equal(when.getSeconds(), 56);
  assert.equal(when.getMilliseconds(), 197);

  // and a duration read from two lines is the raid, not the read
  const start = lineTime('2026-09-12 01:03:54.000|x|Info|application|GameStarted:1');
  const end = lineTime('2026-09-12 01:21:36.000|x|Info|application|PrepareSelectedProfileLocally');
  assert.equal(Math.round((end - start) / 60000), 18);

  assert.equal(lineTime('GameStarted with no date in front'), null);
  assert.equal(lineTime('1999-01-01 00:00:00.000|a clock that far off is not a clock'), null);
  assert.equal(lineTime(''), null);
});

test('every renderer module imports the names it uses from another module', () => {
  // The split into modules put ~150 functions behind explicit imports, and a
  // missing one is invisible everywhere it matters: `node --check` passes,
  // every test above passes, and the ReferenceError is often swallowed by the
  // caller, so the panel merely renders empty with a clean console.
  // quest-list.js called scheduleBriefAlign after it had moved from app.js to
  // quest-brief.js, and that survived a syntax sweep over every module and a
  // direct call into renderDetail before the smoke suite caught it thirteen
  // checks deep - with ten more failures cascading behind it.
  //
  // Comments and string literals ARE stripped here, which is the opposite of
  // what the lifting tools in the scratchpad do, and the reason is worth
  // keeping. Deciding what a new module must import, under-importing is fatal
  // and over-importing is harmless, so those never strip. Deciding whether an
  // existing module is broken it is the other way round: a false alarm stops
  // the suite, and `view` occurs in dashboard.js only inside a sentence about
  // the map view.
  const dir = path.join(import.meta.dirname, '..', 'app');
  const files = fs
    .readdirSync(dir)
    .filter(
      name => name.endsWith('.js') && name !== 'price-overlay.js' && name !== 'battlepass.js'
    );

  const read = name => fs.readFileSync(path.join(dir, name), 'utf8');
  const owner = new Map();
  for (const name of files)
    for (const m of read(name).matchAll(
      /^export (?:async )?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm
    ))
      owner.set(m[1], name);
  assert.ok(owner.size > 100, 'the scan must find the renderer exports, not nothing');

  const broken = [];
  for (const name of files) {
    const raw = read(name);
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');

    // The import scan reads `raw`, not `code`: a specifier IS a string, and
    // `code` has had every string blanked out, so './dom.js' is '' by then.
    // Written against `code` this check matched nothing at all and reported a
    // clean tree over two genuinely scrambled files.
    const known = new Set();
    // Where each name is imported FROM, not merely that it is imported. A tool
    // that rewrites an import block can run past the end of it and merge two
    // blocks into one, leaving a name under the wrong specifier - and then
    // every "is it imported" check passes while the renderer refuses to load
    // with "does not provide an export named". That shipped here once.
    for (const m of raw.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/([a-z-]+\.js)'/g))
      for (const part of m[1].split(',')) {
        if (!part.trim()) continue;
        const source = part.trim().split(/\s+as\s+/)[0];
        known.add(
          part
            .trim()
            .split(/\s+as\s+/)
            .pop()
        );
        const real = owner.get(source);
        if (real && real !== m[2])
          broken.push(
            name + ' imports ' + source + " from '" + m[2] + "', which does not export it"
          );
      }
    for (const m of code.matchAll(/\b(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g))
      known.add(m[1]);
    // parameters, and the names a destructuring pattern binds
    for (const m of code.matchAll(/[({[]([^)}\]]*)[)}\]]/g))
      for (const part of m[1].split(',')) {
        const bound = part
          .trim()
          .replace(/[=:].*/, '')
          .trim();
        if (/^[A-Za-z_$][\w$]*$/.test(bound)) known.add(bound);
      }

    // No \b on the identifier: the DOM helper is a bare $, which \b cannot see.
    // And `.name` is a property access while `...name` is a spread and a real
    // use, so telling the two apart needs the characters before the dot. Four
    // tools shared the naive version at once; app.js used containerLayers only
    // through a spread, every one of them called the file clean, and the
    // renderer booted to an empty window with the ReferenceError swallowed by
    // start().catch.
    for (const m of code.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const i = m.index;
      if (code[i - 1] === '.' && !(code[i - 2] === '.' && code[i - 3] === '.')) continue;
      const from = owner.get(m[0]);
      if (from && from !== name && !known.has(m[0]))
        broken.push(name + ' uses ' + m[0] + ' without importing it from ' + from);
    }
  }

  assert.deepEqual([...new Set(broken)], []);
});

test('nothing in a circular import is used while the modules are evaluating', () => {
  // The main process and the renderer are both cycles on purpose: main.js
  // imports catalogs.js and catalogs.js imports back; app.js imports twenty
  // modules and every one of them imports app.js. That is safe for exactly one
  // reason - the borrowed names are read when something is CALLED, by which
  // time both modules have finished evaluating.
  //
  // A top-level `const` initialiser is the exception, and it is not a
  // theoretical one. catalogs.js reads the quest catalogues into consts at the
  // top of the file:
  //
  //     export const questData = JSON.parse(fs.readFileSync(path.join(assetRoot, ...)))
  //
  // and assetRoot came from main.js. main.js is what imports catalogs.js, so
  // catalogs.js evaluates FIRST and assetRoot is still in its temporal dead
  // zone. The application died on launch with "Cannot access 'assetRoot'
  // before initialization" - not a missing export, so no import check could
  // see it, and node --check parses it happily. assetRoot lives in paths.js
  // now: a leaf with no imports cannot be in a cycle.
  const dirs = [
    ['../main', null],
    ['../app', null]
  ];

  const offenders = [];
  for (const [rel, only] of dirs) {
    const dir = path.join(import.meta.dirname, rel);
    const files = (only || fs.readdirSync(dir).filter(f => f.endsWith('.js'))).filter(
      f => !['price-overlay.js', 'battlepass.js'].includes(f)
    );

    // who imports whom, so a cycle can be recognised
    const importsOf = new Map();
    for (const file of files) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      importsOf.set(
        file,
        [...text.matchAll(/from '\.\/([a-z-]+\.js)'/g)]
          .map(m => m[1])
          .filter(m => files.includes(m))
      );
    }
    const reaches = (from, to, seen = new Set()) => {
      if (from === to) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      return (importsOf.get(from) || []).some(next => reaches(next, to, seen));
    };

    for (const file of files) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      // name -> which module it was imported from
      const source = new Map();
      for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/([a-z-]+\.js)'/g))
        for (const part of m[1].split(',')) {
          if (!part.trim()) continue;
          source.set(
            part
              .trim()
              .split(/\s+as\s+/)
              .pop(),
            m[2]
          );
        }
      if (!source.size) continue;

      // Top-level const/let initialisers that are not functions. Those are the
      // statements that run the moment the module is evaluated.
      const lines = text.split('\n');
      let depth = 0;
      for (let i = 0; i < lines.length; i++) {
        const code = lines[i]
          // Regex literals before anything else. `$` is both the DOM helper
          // and a regex anchor, and map-layers.js declares
          // /...(floor|level)$|^basement$/i - read as identifiers those two
          // dollars made the file look like it called $() as it loaded.
          .replace(/=\s*\/(?:[^/\\\n]|\\.)+\/[gimsuy]*/g, '= 0')
          .replace(/'(?:[^'\\]|\\.)*'/g, "''")
          .replace(/"(?:[^"\\]|\\.)*"/g, '""')
          .replace(/`(?:[^`\\]|\\.)*`/g, '``')
          .replace(/\/\/.*$/, '')
          .replace(/\/\*.*?\*\//g, ' ');
        const starts =
          depth === 0 && /^(?:export\s+)?(?:const|let)\s+[A-Za-z_$][\w$]*\s*=/.test(code);
        if (starts && !/=\s*(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(code)) {
          // read to the end of the statement
          let statement = code,
            d = 0;
          for (const ch of code) d += '{(['.includes(ch) ? 1 : '})]'.includes(ch) ? -1 : 0;
          for (let j = i + 1; d > 0 && j < lines.length; j++) {
            statement += '\n' + lines[j];
            for (const ch of lines[j]) d += '{(['.includes(ch) ? 1 : '})]'.includes(ch) ? -1 : 0;
          }
          for (const m of statement.matchAll(/[A-Za-z_$][\w$]*/g)) {
            const k = m.index;
            if (statement[k - 1] === '.') continue;
            const from = source.get(m[0]);
            if (from && reaches(from, file))
              offenders.push(
                file +
                  ' uses ' +
                  m[0] +
                  ' from ' +
                  from +
                  ' while it is still evaluating, and ' +
                  from +
                  ' imports ' +
                  file +
                  ' back'
              );
          }
        }
        for (const ch of code) depth += '{(['.includes(ch) ? 1 : '})]'.includes(ch) ? -1 : 0;
      }
    }
  }
  assert.deepEqual([...new Set(offenders)], []);
});
