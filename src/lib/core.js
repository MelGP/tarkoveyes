import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

// Format reference: Raid Signal (Apache-2.0), see licenses and THIRD-PARTY.md.
// This parser reads filenames only. It never opens screenshot images.
function parseScreenshot(filename) {
  const n = '(-?\\d+(?:\\.\\d+)?)';
  const re = new RegExp(
    '\\][ _]*' +
      n +
      '\\s*,\\s*' +
      n +
      '\\s*,\\s*' +
      n +
      '(?:\\s*_\\s*' +
      n +
      '\\s*,\\s*' +
      n +
      '\\s*,\\s*' +
      n +
      '\\s*,\\s*' +
      n +
      ')?' +
      '(?:\\s*_\\s*' +
      n +
      ')?\\s*(?:\\(\\d+\\))?\\.png$',
    'i'
  );
  const m = path.basename(filename).match(re);
  if (!m) return null;
  const [x, y, z] = m.slice(1, 4).map(Number);
  if (![x, y, z].every(v => Number.isFinite(v) && Math.abs(v) < 100000)) return null;
  let heading = null;
  if (m[4] !== undefined) {
    let [qx, qy, qz, qw] = m.slice(4, 8).map(Number);
    const norm = Math.hypot(qx, qy, qz, qw);
    if (norm > 0.0001 && Number.isFinite(norm)) {
      [qx, qy, qz, qw] = [qx, qy, qz, qw].map(v => v / norm);
      const fx = 2 * (qx * qz + qw * qy),
        fz = 1 - 2 * (qx * qx + qy * qy);
      if (Math.hypot(fx, fz) > 0.0001) {
        heading = (Math.atan2(fx, fz) * 180) / Math.PI;
        if (Math.abs(heading) < 1e-10) heading = 0;
      }
    }
  }
  return { x, y, z, heading };
}

const aliases = {
  bigmap: 'customs',
  customs: 'customs',
  woods: 'woods',
  factory4_day: 'factory',
  factory4_night: 'factory',
  sandbox: 'ground-zero',
  sandbox_high: 'ground-zero',
  interchange: 'interchange',
  lighthouse: 'lighthouse',
  rezervbase: 'reserve',
  shoreline: 'shoreline',
  tarkovstreets: 'streets-of-tarkov',
  streets: 'streets-of-tarkov',
  laboratory: 'the-lab',
  lab: 'the-lab',
  labyrinth: 'the-labyrinth',
  terminal: 'terminal',
  icebreaker: 'icebreaker'
};
function canonicalMap(s) {
  return (
    aliases[
      s
        ?.toLowerCase()
        .replace(/(?:\.scenespreset)?\.asset$|\.bundle$/g, '')
        .replace(/[_-]preset$/, '')
    ] || null
  );
}
/* Every log line starts '2026-09-13 02:10:04.727|'. The observer used to stamp
 * a raid with Date.now(), which is when the application READ the line, not
 * when it happened - so a session read after the fact recorded a whole raid as
 * forty-two seconds long, and half the raid history came out shorter than a
 * raid can be. Local time, because that is what the game writes. */
function lineTime(line) {
  const stamp = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3})/.exec(line);
  if (!stamp) return null;
  const at = Date.parse(stamp[1] + 'T' + stamp[2]);
  /* a clock that disagrees with this one by more than a year is not a clock */
  return Number.isFinite(at) && Math.abs(at - Date.now()) < 366 * 24 * 3600 * 1000 ? at : null;
}

function parseLogLine(line) {
  const session = line.match(/Session mode:\s*(Pve|PVE|Regular|PVP|PvpSeason|Seasonal|SZN)\b/i);
  if (session) {
    const raw = session[1].toLowerCase();
    return {
      type: 'mode',
      mode: raw === 'pve' ? 'pve' : /season|szn/.test(raw) ? 'seasonal' : 'pvp'
    };
  }
  const scene = line.match(/scene preset path:\s*maps\/([\w-]+)\.bundle(?:.*?\brcid:([\w-]+))?/i);
  const location = line.match(/\bLocation:\s*([\w-]+)/i);
  const map = scene
    ? canonicalMap(scene[1]) || canonicalMap(scene[2])
    : canonicalMap(location?.[1]);
  if (map) return { type: 'map', map };
  if (/PrepareSelectedProfileLocally|UserMatchOver/.test(line)) return { type: 'end' };
  if (/\|application\|GameStarted:|\|application\|GameStarting/.test(line))
    return { type: 'start' };
  return null;
}
function parseQuestNotifications(text) {
  const result = [];
  const eventFrom = payload => {
    const message = payload?.message,
      type = Number(message?.type),
      template = String(message?.templateId || ''),
      suffix = template.slice(24).trim();
    const status = /^successMessageText\b/i.test(suffix)
      ? 'completed'
      : /^failMessageText\b/i.test(suffix)
        ? 'failed'
        : /^description\b/i.test(suffix) || (type === 10 && suffix !== '0')
          ? 'active'
          : null;
    const id = template.match(/^([a-f0-9]{24})(?:\s|$)/i)?.[1]?.toLowerCase();
    if (!status || !id) return null;
    const observedAt = Number.isFinite(Number(message.dt)) ? Number(message.dt) * 1000 : Date.now();
    return {
      type: 'quest',
      id,
      status,
      // The notification names the trader that sent it. For a quest the bundled
      // catalogues do not know, that is the only identifying detail available.
      trader: /^[a-f0-9]{24}$/i.test(String(message.uid || ''))
        ? String(message.uid).toLowerCase()
        : null,
      eventId: String(payload.eventId || `${id}:${status}:${observedAt}`),
      observedAt
    };
  };
  const records =
    /^\d{4}-\d{2}-\d{2}[^\r\n]*Got notification \| ChatMessageReceived\s*\r?\n(\{[\s\S]*?^\})\s*$/gm;
  for (const match of text.matchAll(records)) {
    try {
      const event = eventFrom(JSON.parse(match[1]));
      if (event) result.push(event);
    } catch {}
  }
  return result;
}

async function readLogSlice(file, limit, fromStart = false) {
  const stat = await fs.promises.stat(file),
    length = Math.min(stat.size, limit),
    start = fromStart ? 0 : Math.max(0, stat.size - length);
  if (!length) return '';
  const handle = await fs.promises.open(file, 'r'),
    buffer = Buffer.alloc(length);
  let bytesRead = 0;
  try {
    ({ bytesRead } = await handle.read(buffer, 0, length, start));
  } finally {
    await handle.close();
  }
  let text = buffer.subarray(0, bytesRead).toString('utf8');
  if (start > 0) text = text.slice(text.indexOf('\n') + 1);
  return text;
}

async function scanQuestHistory(logRoot) {
  if (typeof logRoot !== 'string' || !path.isAbsolute(logRoot))
    throw Error('Choose a valid logs folder first.');
  const rootStat = await fs.promises.stat(logRoot);
  if (!rootStat.isDirectory()) throw Error('Choose a valid logs folder first.');
  const rootEntries = await fs.promises.readdir(logRoot, { withFileTypes: true });
  const folders = [
    logRoot,
    ...rootEntries
      .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
      .map(entry => path.join(logRoot, entry.name))
  ];
  const events = [];
  let notificationFiles = 0,
    ignoredFiles = 0;
  for (const folder of folders) {
    let entries;
    try {
      entries = await fs.promises.readdir(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    const files = entries.filter(entry => entry.isFile()).map(entry => entry.name);
    let mode = null;
    for (const name of files.filter(name => /application.*\.log$/i.test(name)).sort()) {
      let text;
      try {
        text = await readLogSlice(path.join(folder, name), 524288, true);
      } catch {
        continue;
      }
      for (const line of text.split(/\r?\n/)) {
        const event = parseLogLine(line);
        if (event?.type === 'mode') mode = event.mode;
      }
    }
    for (const name of files.filter(name => /(?:push-)?notifications.*\.log$/i.test(name)).sort()) {
      notificationFiles++;
      if (!mode) {
        ignoredFiles++;
        continue;
      }
      let text;
      try {
        text = await readLogSlice(path.join(folder, name), 8388608);
      } catch {
        ignoredFiles++;
        continue;
      }
      for (const event of parseQuestNotifications(text)) events.push({ ...event, mode });
    }
  }
  const unique = [...new Map(events.map(event => [event.eventId, event])).values()];
  unique.sort((a, b) => a.observedAt - b.observedAt || a.eventId.localeCompare(b.eventId));
  return { events: unique, notificationFiles, ignoredFiles };
}
function worldToMap(p) {
  return { x: ((698 - p.x) / 1070) * 1062.4827, y: ((p.z + 307) / 544) * 535.17401 };
}

function objectiveTarget(objective) {
  for (const detail of objective?.details || []) {
    const match = String(detail).match(/(?:required\s+count|count|required)\s*:?\s*(\d+)/i);
    if (match) return Math.max(1, Number(match[1]));
  }
  const description = String(objective?.description || '');
  const match =
    description.match(
      /\b(?:kill|eliminate|find|obtain|hand over|place|plant|mark|stash|locate)\D{0,35}(\d+)\b/i
    ) || description.match(/\b(\d+)\s+(?:pmcs?|scavs?|targets?|items?|markers?)\b/i);
  return match ? Math.max(1, Number(match[1])) : 1;
}
function normalizeOcr(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function textScore(expected, actual) {
  const a = normalizeOcr(expected),
    b = normalizeOcr(actual);
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a))
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const words = new Set(a.split(' ').filter(word => word.length > 2)),
    seen = new Set(b.split(' ').filter(word => word.length > 2));
  if (!words.size) return 0;
  return [...words].filter(word => seen.has(word)).length / words.size;
}
/* Scoring a quest name against a row of the Tasks table.
 *
 * `textScore` cannot do this, and measuring it on a real screenshot showed
 * why in two ways at once.
 *
 * Its first branch rewards containment with the ratio of the two lengths. A
 * row of that table is the name **plus** Location, Status and Progress, so a
 * perfect hit on "The Tarkov Shooter - Part 7" scored 27 characters over about
 * a hundred: **0.27**, under every threshold. Short names never stood a chance -
 * Silent Caliber, Bullshit, Our Own Land and Reconnaissance were all read
 * correctly and all thrown away.
 *
 * Its second branch then drops words of two characters or fewer, which throws
 * away the part number. "Part 1" and "Part 7" have identical word sets, so
 * Parts 1 through 6 each scored **1.00** against the row that says Part 7.
 *
 * The correct quest scored 0.27 and six wrong ones scored 1.00.
 *
 * So: containment is worth 1, nothing is dropped for being short, and a number
 * in the name that is missing from the row caps the score below any threshold -
 * a different part number is a different quest, not a near miss.
 */
function questRowScore(name, line) {
  const a = normalizeOcr(name),
    b = normalizeOcr(line);
  if (!a || !b) return 0;
  if (b.includes(a)) return 1;
  const want = a.split(' ').filter(Boolean),
    have = new Set(b.split(' ').filter(Boolean));
  if (!want.length) return 0;
  let hit = 0,
    numberMissed = false;
  for (const word of want) {
    if (have.has(word)) hit++;
    else if (/^\d+$/.test(word)) numberMissed = true;
  }
  const score = hit / want.length;
  if (numberMissed) return Math.min(score, 0.45);
  if (score >= 0.72 || !want.length) return score;

  /* Word overlap is all-or-nothing per word, so a single lost character sinks
     a one-word name completely: the OCR read Bullshit as "Bulshit" and the
     quest scored zero. Compare letter pairs against the windows of the row
     that are the right length, which is the same shape of fallback the item
     matcher uses on a misread inventory label.

     Only ever as a rescue, never as a promotion: it cannot beat a real word
     match, and a wrong number still caps the score above. */
  const words = b.split(' ').filter(Boolean);
  let rescued = 0;
  for (let i = 0; i + want.length <= words.length; i++) {
    const window = words.slice(i, i + want.length).join(' ');
    const near = bigramScore(a, window);
    if (near > rescued) rescued = near;
  }
  return Math.max(score, rescued);
}
/* Dice coefficient over letter pairs: forgiving of a dropped or swapped
   character, unforgiving of a different word. */
function bigramScore(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = s => {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const k = s.slice(i, i + 2);
      out.set(k, (out.get(k) || 0) + 1);
    }
    return out;
  };
  const left = pairs(a),
    right = pairs(b);
  let shared = 0;
  for (const [k, n] of left) shared += Math.min(n, right.get(k) || 0);
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}
/* What the row says beside the name. The table carries Status and Progress in
   the same line, and reading them costs nothing: "activel" is how the OCR sees
   "active!", and the percentage is the quest's own progress bar. */
function questRowFacts(line) {
  const percent = String(line).match(/(\d{1,3})\s*%/);
  return {
    active: /activ[e3]l?!?/i.test(line),
    percent: percent ? Math.min(100, Number(percent[1])) : null
  };
}
function parseTaskOcr(text, questCatalog, activeIds = []) {
  const lines = String(text || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean),
    active = new Set(activeIds || []),
    results = [];

  /* Line first, not catalogue first.

     Walking the catalogue and giving every quest its best line lets one row be
     claimed by a dozen quests - which is exactly what happened: three real rows
     produced fifteen matches, twelve of them other parts of the same series.
     A row of that table is one quest, so each row picks its best quest and each
     quest is taken once. */
  const taken = new Set();
  const claims = [];
  lines.forEach((line, index) => {
    let best = null,
      bestScore = 0;
    for (const quest of questCatalog || []) {
      const score = questRowScore(quest.name, line);
      /* Longest name wins a tie, and the tie is the common case: a row reading
         "The Tarkov Import ... Reserve ... active!" contains the quests Import,
         Reserve AND The Tarkov Import, all at 1.00, and there are 73 one-word
         quest names to collide with the Location column. Without this the
         winner was whichever happened to come first in the catalogue. A longer
         containment is more of the row explained, so it is better evidence. */
      if (
        score > bestScore ||
        (score === bestScore && best && quest.name.length > best.name.length)
      ) {
        bestScore = score;
        best = quest;
      }
    }
    if (!best) return;
    const threshold = active.has(best.id) ? 0.52 : 0.72;
    if (bestScore < threshold) return;
    /* Every row of this table carries its status, so a line that does not is
       not a row - it is a heading, a footer or the stash panel beside it. That
       alone threw out a quest called Documents matched against the task-items
       caption, and the version string in the corner, whose "1.1.5.0.47242"
       supplied the digit that made The Punisher - Part 1 look plausible. */
    if (!questRowFacts(line).active) return;
    claims.push({ quest: best, index, score: bestScore, line });
  });
  /* Strongest claim on a quest wins it, so a stray line cannot take a quest
     away from the row that actually names it. */
  claims.sort((a, b) => b.score - a.score);

  for (const claim of claims) {
    if (taken.has(claim.quest.id)) continue;
    taken.add(claim.quest.id);
    const quest = claim.quest,
      facts = questRowFacts(claim.line),
      from = Math.max(0, claim.index - 2),
      to = Math.min(
        lines.length,
        claim.index + Math.max(10, (quest.objectives?.length || 0) * 4) + 2
      ),
      windowLines = lines.slice(from, to),
      objectives = [];
    for (const objective of quest.objectives || []) {
      let lineIndex = -1,
        confidence = 0;
      windowLines.forEach((line, index) => {
        const score = textScore(objective.description, line);
        if (score > confidence) {
          confidence = score;
          lineIndex = index;
        }
      });
      if (confidence < 0.38) continue;
      const neighborhood = windowLines.slice(Math.max(0, lineIndex - 1), lineIndex + 3).join(' '),
        progress = neighborhood.match(/\b(\d+)\s*[/]\s*(\d+)\b/),
        target = progress ? Number(progress[2]) : objectiveTarget(objective),
        value = progress ? Math.min(Number(progress[1]), target) : 0;
      const completed = /\b(?:completed|complete|done)\b/i.test(neighborhood) || value >= target;
      objectives.push({
        id: objective.id,
        description: objective.description,
        value: completed ? target : value,
        target,
        confirmed: completed,
        confidence: Number(confidence.toFixed(2))
      });
    }
    results.push({
      questId: quest.id,
      questName: quest.name,
      confidence: Number(claim.score.toFixed(2)),
      /* The row itself says the quest is active and how far along it is. That
         is the whole point of scanning this screen, and the old parser threw
         both away and reported only objectives it could not find. */
      rowActive: facts.active,
      percent: facts.percent,
      objectives
    });
  }
  return results.sort(
    (a, b) => b.confidence - a.confidence || a.questName.localeCompare(b.questName)
  );
}

class Store {
  constructor(directory) {
    this.file = path.join(directory, 'progress.json');
    const freshProfile = () => ({
      quests: {},
      objectives: {},
      objectiveProgress: {},
      questSources: {},
      questSync: {
        parserVersion: 2,
        seenEvents: [],
        lastEventAt: null,
        lastScanAt: null,
        history: []
      },
      raidHidden: {},
      raidChecklist: {},
      raidPlans: {},
      raidHistory: [],
      customMarkers: {},
      questNotes: {},
      favorites: [],
      hiddenQuests: []
    });
    this.data = {
      version: 1,
      settings: {
        screenshots: '',
        logs: '',
        autoFollow: true,
        itemHotkeyEnabled: true,
        itemValueThreshold: 15000,
        mapLayers: {
          extracts: true,
          pmcExtractNames: false,
          scavs: false,
          scavExtractNames: false,
          transits: false,
          transitNames: false,
          containerMedical: false,
          containerRations: false,
          containerTechnical: false,
          containerWeapons: false,
          containerValuables: false,
          containerCaches: false,
          looseValuables: false,
          looseBattlepass: false,
          looseMedical: false,
          looseProvisions: false,
          looseTechnical: false,
          looseKeys: false,
          looseWeapons: false,
          looseGear: false,
          looseTask: false,
          looseOther: false,
          labsKeycards: true,
          labsKeycardNames: false,
          landmarks: true,
          customMarkers: true
        }
      },
      profiles: { pvp: freshProfile(), pve: freshProfile(), seasonal: freshProfile() },
      mode: 'pvp'
    };
    this.error = null;
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (d.version === 1 && d.profiles?.pvp && d.profiles?.pve) {
        const savedLayers = d.settings?.mapLayers || {},
          legacyNames = !!savedLayers.extractNames;
        const migratedLayers = {
          ...this.data.settings.mapLayers,
          ...savedLayers,
          pmcExtractNames: savedLayers.pmcExtractNames ?? legacyNames,
          scavExtractNames: savedLayers.scavExtractNames ?? legacyNames
        };
        if (savedLayers.lootContainers === true && !Object.hasOwn(savedLayers, 'containerMedical'))
          for (const key of [
            'containerMedical',
            'containerRations',
            'containerTechnical',
            'containerWeapons',
            'containerValuables',
            'containerCaches'
          ])
            migratedLayers[key] = true;
        if (savedLayers.looseLoot === true && !Object.hasOwn(savedLayers, 'looseValuables'))
          for (const key of [
            'looseValuables',
            'looseBattlepass',
            'looseMedical',
            'looseProvisions',
            'looseTechnical',
            'looseKeys',
            'looseWeapons',
            'looseGear',
            'looseTask',
            'looseOther'
          ])
            migratedLayers[key] = true;
        this.data = {
          ...this.data,
          ...d,
          settings: { ...this.data.settings, ...d.settings, mapLayers: migratedLayers }
        };
        if (
          !Number.isFinite(this.data.settings.itemValueThreshold) ||
          this.data.settings.itemValueThreshold < 0 ||
          this.data.settings.itemValueThreshold > 1000000
        )
          this.data.settings.itemValueThreshold = 15000;
        for (const mode of ['pvp', 'pve', 'seasonal']) {
          const saved = d.profiles[mode] || {};
          this.data.profiles[mode] = {
            ...freshProfile(),
            ...saved,
            questSync: { ...freshProfile().questSync, ...saved.questSync }
          };
          this.data.profiles[mode].questSync.parserVersion =
            Number(saved.questSync?.parserVersion) || 1;
          if (!Array.isArray(this.data.profiles[mode].questSync.history))
            this.data.profiles[mode].questSync.history = [];
          if (
            !this.data.profiles[mode].raidHidden ||
            typeof this.data.profiles[mode].raidHidden !== 'object'
          )
            this.data.profiles[mode].raidHidden = {};
          if (
            !this.data.profiles[mode].raidChecklist ||
            typeof this.data.profiles[mode].raidChecklist !== 'object'
          )
            this.data.profiles[mode].raidChecklist = {};
          if (
            !this.data.profiles[mode].raidPlans ||
            typeof this.data.profiles[mode].raidPlans !== 'object'
          )
            this.data.profiles[mode].raidPlans = {};
          if (
            !this.data.profiles[mode].objectiveProgress ||
            typeof this.data.profiles[mode].objectiveProgress !== 'object'
          )
            this.data.profiles[mode].objectiveProgress = {};
          if (!Array.isArray(this.data.profiles[mode].raidHistory))
            this.data.profiles[mode].raidHistory = [];
          if (
            !this.data.profiles[mode].customMarkers ||
            typeof this.data.profiles[mode].customMarkers !== 'object'
          )
            this.data.profiles[mode].customMarkers = {};
          if (
            !this.data.profiles[mode].questNotes ||
            typeof this.data.profiles[mode].questNotes !== 'object'
          )
            this.data.profiles[mode].questNotes = {};
          if (!Array.isArray(this.data.profiles[mode].favorites))
            this.data.profiles[mode].favorites = [];
          /* Added after people already had saved profiles, so it has to default
             here as well as in the shape above - an older file has no such key
             and every read of it would otherwise be undefined. */
          if (!Array.isArray(this.data.profiles[mode].hiddenQuests))
            this.data.profiles[mode].hiddenQuests = [];
        }
      } else this.error = 'Unrecognized saved data. A recovery copy will be kept.';
    } catch (e) {
      if (e.code !== 'ENOENT')
        this.error = 'Saved data could not be read. A recovery copy will be kept.';
    }
  }
  write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (this.error && fs.existsSync(this.file)) {
      fs.copyFileSync(this.file, this.file + '.recovery-' + Date.now());
      this.error = null;
    }
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
  applyQuestEvent(mode, event) {
    const profile = this.data.profiles[mode];
    if (!profile) return false;
    const seen = profile.questSync.seenEvents;
    if (seen.includes(event.eventId)) return false;
    seen.push(event.eventId);
    if (seen.length > 2000) seen.splice(0, seen.length - 2000);
    const changed = profile.quests[event.id] !== event.status;
    profile.quests[event.id] = event.status;
    profile.questSources[event.id] = 'logs';
    profile.questSync.lastEventAt = event.observedAt;
    if (changed) this.recordQuestChange(mode, event);
    this.write();
    return changed;
  }
  recordQuestChange(mode, event) {
    const history = this.data.profiles[mode]?.questSync?.history;
    if (!history) return;
    history.unshift({
      eventId: event.eventId,
      id: event.id,
      status: event.status,
      observedAt: event.observedAt,
      source: 'logs'
    });
    if (history.length > 100) history.length = 100;
  }
  applyQuestHistory(events, scannedAt = Date.now()) {
    const modes = ['pvp', 'pve', 'seasonal'],
      latest = new Map(),
      summary = {};
    for (const mode of modes)
      summary[mode] = {
        events: 0,
        quests: 0,
        active: 0,
        failed: 0,
        completed: 0,
        changed: 0,
        changes: []
      };
    for (const event of events) {
      if (
        !modes.includes(event.mode) ||
        !event.id ||
        !['active', 'failed', 'completed'].includes(event.status)
      )
        continue;
      summary[event.mode].events++;
      const key = event.mode + ':' + event.id,
        previous = latest.get(key);
      if (!previous || event.observedAt >= previous.observedAt) latest.set(key, event);
      const seen = this.data.profiles[event.mode].questSync.seenEvents;
      if (!seen.includes(event.eventId)) seen.push(event.eventId);
    }
    for (const mode of modes) {
      const profile = this.data.profiles[mode],
        seen = profile.questSync.seenEvents,
        previousParser = Number(profile.questSync.parserVersion) || 1;
      if (seen.length > 2000) seen.splice(0, seen.length - 2000);
      const modeEvents = [...latest.values()].filter(event => event.mode === mode);
      if (previousParser < 2) {
        const validFailed = new Set(
          modeEvents.filter(event => event.status === 'failed').map(event => event.id)
        );
        for (const [id, value] of Object.entries(profile.quests))
          if (value === 'failed' && profile.questSources[id] === 'logs' && !validFailed.has(id)) {
            delete profile.quests[id];
            delete profile.questSources[id];
            summary[mode].changed++;
            summary[mode].changes.push({ id, status: 'untracked', observedAt: scannedAt });
          }
      }
      for (const event of modeEvents) {
        if (profile.quests[event.id] !== event.status) {
          summary[mode].changed++;
          summary[mode].changes.push({
            id: event.id,
            status: event.status,
            observedAt: event.observedAt
          });
          this.recordQuestChange(mode, event);
        }
        profile.quests[event.id] = event.status;
        profile.questSources[event.id] = 'logs';
        summary[mode][event.status]++;
      }
      summary[mode].quests = modeEvents.length;
      const lastAt = events
        .filter(event => event.mode === mode)
        .reduce((max, event) => Math.max(max, event.observedAt || 0), 0);
      if (lastAt) profile.questSync.lastEventAt = lastAt;
      profile.questSync.lastScanAt = scannedAt;
      profile.questSync.parserVersion = 2;
    }
    this.write();
    return summary;
  }
  recordRaidEvent(mode, event) {
    const profile = this.data.profiles[mode];
    if (!profile) return null;
    const history = profile.raidHistory;
    if (event.type === 'start') {
      const last = history[0];
      if (last?.status === 'active') return last;
      history.unshift({
        id: String(event.id || Date.now()),
        map: event.map || null,
        role: event.role || 'pmc',
        startedAt: event.at || Date.now(),
        endedAt: null,
        status: 'active',
        outcome: 'unknown',
        questIds: Array.isArray(event.questIds) ? event.questIds.slice(0, 200) : []
      });
    } else if (event.type === 'end') {
      const last = history.find(item => item.status === 'active');
      if (!last) return null;
      last.endedAt = event.at || Date.now();
      last.status = 'ended';
      last.outcome = ['survived', 'died', 'run-through', 'unknown'].includes(event.outcome)
        ? event.outcome
        : 'unknown';
    } else if (event.type === 'outcome') {
      const raid = history.find(item => item.id === event.id);
      if (!raid) return null;
      raid.outcome = ['survived', 'died', 'run-through', 'unknown'].includes(event.outcome)
        ? event.outcome
        : 'unknown';
      this.write();
      return raid;
    }
    if (history.length > 100) history.length = 100;
    this.write();
    return history[0] || null;
  }
}

// Read-only folder observer. No process handles, input hooks or game writes.
class Observer extends EventEmitter {
  constructor() {
    super();
    this.generation = 0;
    this.timer = null;
    this.busy = false;
    this.seen = new Map();
    this.offsets = new Map();
    this.questSeen = new Set();
    this.sessionModes = new Map();
    this.state = {
      connected: false,
      position: null,
      map: null,
      mode: null,
      raid: 'unknown',
      screenshotCount: 0,
      logsConnected: false,
      logSession: null,
      logFileCount: 0,
      lastLogScanAt: null,
      lastQuestEventAt: null,
      error: null
    };
  }
  async start(settings) {
    this.stop();
    while (this.busy) await new Promise(resolve => setTimeout(resolve, 20));
    this.settings = settings;
    this.seen.clear();
    this.offsets.clear();
    this.questSeen.clear();
    this.sessionModes.clear();
    this.state = {
      connected: false,
      position: null,
      map: null,
      mode: null,
      raid: 'unknown',
      screenshotCount: 0,
      logsConnected: false,
      logSession: null,
      logFileCount: 0,
      lastLogScanAt: null,
      lastQuestEventAt: null,
      error: null
    };
    const generation = this.generation;
    await this.scan(true, generation);
    if (generation !== this.generation) return;
    this.timer = setInterval(() => this.scan(false, generation), 1500);
    this.timer.unref?.();
  }
  stop() {
    this.generation++;
    clearInterval(this.timer);
    this.timer = null;
  }
  async scan(initial = false, generation = this.generation) {
    if (this.busy) return;
    this.busy = true;
    try {
      const state = { ...this.state, error: null };
      // Log context is read before new screenshots; old screenshots are never
      // assigned to the latest raid on startup.
      if (this.settings.logs) {
        try {
          const dirs = await fs.promises.readdir(this.settings.logs, { withFileTypes: true });
          const candidates = [];
          for (const d of dirs
            .filter(d => d.isDirectory() && !d.isSymbolicLink())
            .sort((a, b) => b.name.localeCompare(a.name))
            .slice(0, 3)) {
            const folder = path.join(this.settings.logs, d.name);
            for (const f of await fs.promises.readdir(folder))
              if (/application.*\.log$|output_\d+\.log$|push-notifications.*\.log$/i.test(f))
                candidates.push(path.join(folder, f));
          }
          for (const f of dirs.filter(
            d =>
              d.isFile() &&
              /application.*\.log$|output_\d+\.log$|push-notifications.*\.log$/i.test(d.name)
          ))
            candidates.push(path.join(this.settings.logs, f.name));
          const files = await Promise.all(
            candidates.map(async f => ({ f, s: await fs.promises.stat(f) }))
          );
          const latest =
            files
              .filter(x => /application.*\.log$/i.test(x.f))
              .sort((a, b) => b.s.mtimeMs - a.s.mtimeMs)[0] ||
            files
              .filter(x => /output_\d+\.log$/i.test(x.f))
              .sort((a, b) => b.s.mtimeMs - a.s.mtimeMs)[0];
          const notifications = files
            .filter(x => /push-notifications/i.test(x.f))
            .sort((a, b) => a.s.mtimeMs - b.s.mtimeMs);
          state.logsConnected = !!(latest || notifications.length);
          state.logFileCount = files.length;
          state.logSession = latest
            ? path.basename(path.dirname(latest.f))
            : notifications.length
              ? path.basename(path.dirname(notifications.at(-1).f))
              : null;
          state.lastLogScanAt = Date.now();
          // Each log session carries its own profile mode. Keep that context per
          // folder so an older PvP notification can never be assigned to a newer
          // PvE or Seasonal session while several folders are being watched.
          const sessionFolders = [...new Set(files.map(item => path.dirname(item.f)))];
          for (const folder of sessionFolders) {
            if (this.sessionModes.has(folder)) continue;
            const application = files
              .filter(
                item => path.dirname(item.f) === folder && /application.*\.log$/i.test(item.f)
              )
              .sort((a, b) => a.f.localeCompare(b.f))[0];
            if (!application) continue;
            let text = '';
            try {
              text = await readLogSlice(application.f, 524288, true);
            } catch {
              continue;
            }
            for (const line of text.split(/\r?\n/)) {
              const event = parseLogLine(line);
              if (event?.type === 'mode') this.sessionModes.set(folder, event.mode);
            }
          }
          if (latest) {
            const { f, s } = latest;
            const old = this.offsets.get(f);
            const fresh = !old || s.size < old.size;
            const from = fresh ? Math.max(0, s.size - 262144) : old.size;
            const length = Math.min(262144, s.size - from);
            if (length > 0) {
              const handle = await fs.promises.open(f, 'r');
              const buf = Buffer.alloc(length);
              let bytesRead;
              try {
                ({ bytesRead } = await handle.read(buf, 0, length, from));
              } finally {
                await handle.close();
              }
              let chunk = (fresh ? '' : old.pending) + buf.subarray(0, bytesRead).toString('utf8');
              if (fresh && from > 0) chunk = chunk.slice(chunk.indexOf('\n') + 1);
              const lines = chunk.split('\n');
              const pending = lines.pop();
              for (const line of lines) {
                const event = parseLogLine(line);
                if (!event) continue;
                if (event.type === 'mode') {
                  state.mode = event.mode;
                  this.sessionModes.set(path.dirname(f), event.mode);
                }
                if (event.type === 'map') {
                  state.map = event.map;
                  state.raid = 'loading';
                  state.position = null;
                }
                const happenedAt = lineTime(line);
                if (event.type === 'end') {
                  state.raid = 'ended';
                  state.raidAt = happenedAt;
                  state.position = null;
                }
                if (event.type === 'start') {
                  state.raid = 'started';
                  state.raidAt = happenedAt;
                }
              }
              this.offsets.set(f, {
                size: from + bytesRead,
                pending: pending.length < 32768 ? pending : ''
              });
            }
            state.mode = this.sessionModes.get(path.dirname(f)) || state.mode;
          }
          for (const { f, s } of notifications) {
            const sessionMode = this.sessionModes.get(path.dirname(f));
            if (!sessionMode) continue;
            const old = this.offsets.get(f),
              fresh = !old || s.size < old.size,
              from = fresh ? Math.max(0, s.size - 262144) : old.size;
            const length = Math.min(262144, s.size - from);
            if (length <= 0) continue;
            const handle = await fs.promises.open(f, 'r'),
              buf = Buffer.alloc(length);
            let bytesRead;
            try {
              ({ bytesRead } = await handle.read(buf, 0, length, from));
            } finally {
              await handle.close();
            }
            let chunk = (old?.pending || '') + buf.subarray(0, bytesRead).toString('utf8');
            if (fresh && from > 0) chunk = chunk.slice(chunk.indexOf('\n') + 1);
            for (const event of parseQuestNotifications(chunk)) {
              if (this.questSeen.has(event.eventId)) continue;
              this.questSeen.add(event.eventId);
              event.mode = sessionMode;
              state.lastQuestEventAt = event.observedAt;
              this.emit('quest', event);
            }
            this.offsets.set(f, { size: from + bytesRead, pending: chunk.slice(-65536) });
          }
        } catch {
          state.logsConnected = false;
          state.logSession = null;
          state.logFileCount = 0;
          state.error = 'The logs folder is unavailable. Check the selected folder.';
        }
      }
      if (this.settings.screenshots) {
        try {
          const files = (
            await fs.promises.readdir(this.settings.screenshots, { withFileTypes: true })
          ).filter(d => d.isFile() && /\.png$/i.test(d.name));
          state.connected = true;
          state.screenshotCount = files.length;
          let latest = null;
          for (const f of files) {
            if (this.seen.has(f.name)) continue;
            this.seen.set(f.name, true);
            const p = parseScreenshot(f.name);
            if (!p || initial) continue;
            const s = await fs.promises.stat(path.join(this.settings.screenshots, f.name));
            if (!latest || s.mtimeMs > latest.observedAt)
              latest = {
                ...p,
                observedAt: s.mtimeMs,
                map: state.logsConnected && state.raid === 'started' ? state.map : null,
                source: 'screenshot'
              };
          }
          if (latest) state.position = latest;
        } catch {
          state.connected = false;
          state.error = 'The screenshots folder is unavailable. Check the selected folder.';
        }
      }
      if (generation === this.generation) {
        this.state = state;
        this.emit('state', this.state);
      }
    } finally {
      this.busy = false;
    }
  }
}
export {
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
};
