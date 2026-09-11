const modeSlugs = { pvp: 'regular', pve: 'pve', seasonal: 'pvp-season' };

function translate(dictionary, value) {
  return typeof value === 'string' ? dictionary[value] || value : '';
}
function finitePrice(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.round(Number(value)) : null;
}
function itemCategory(raw, categories, english) {
  const ids = new Set(raw?.handbookCategories || []);
  for (const id of [...ids]) {
    let current = categories[id];
    while (current?.parent && !ids.has(current.parent)) {
      ids.add(current.parent);
      current = categories[current.parent];
    }
  }
  const choices = [
    ['Battle Pass documents', '6a35427afc3f27b15905a876'],
    ['Valuables', '5b47574386f77428ca22b2f1'],
    ['Medication', '5b47574386f77428ca22b344'],
    ['Medical supplies', '5b47574386f77428ca22b2f3'],
    ['Food & drinks', '5b47574386f77428ca22b340'],
    ['Keys', '5b47574386f77428ca22b342'],
    ['Weapons', '5b5f78dc86f77409407a7f8e'],
    ['Ammo', '5b47574386f77428ca22b346'],
    ['Weapon parts', '5b5f71a686f77447ed5636ab'],
    ['Gear', '5b47574386f77428ca22b33f'],
    ['Quest items', '5b5f740a86f77447ec5d7706'],
    ['Info items', '5b47574386f77428ca22b341'],
    ['Special equipment', '5b47574386f77428ca22b345'],
    ['Barter items', '5b47574386f77428ca22b33e']
  ];
  const match = choices.find(([, id]) => ids.has(id)),
    leaf = (raw?.handbookCategories || [])[0];
  return {
    category: match?.[0] || (leaf ? english[leaf] || categories[leaf]?.normalizedName : 'Other'),
    handbookCategories: [...(raw?.handbookCategories || [])]
  };
}

function normalizeItemPayload(
  itemEnvelope,
  englishEnvelope,
  traderEnvelope,
  traderEnglishEnvelope,
  mode
) {
  if (!modeSlugs[mode]) throw Error('Invalid item catalog mode');
  const rawItems = itemEnvelope?.data?.items,
    english = englishEnvelope?.data,
    handbookCategories = itemEnvelope?.data?.handbookCategories || {},
    rawTraders = traderEnvelope?.data,
    traderEnglish = traderEnglishEnvelope?.data;
  if (
    !rawItems ||
    typeof rawItems !== 'object' ||
    !english ||
    typeof english !== 'object' ||
    !rawTraders ||
    typeof rawTraders !== 'object' ||
    !traderEnglish ||
    typeof traderEnglish !== 'object'
  )
    throw Error('Invalid tarkov.dev item response');
  const traderNames = {};
  for (const [id, trader] of Object.entries(rawTraders)) {
    const key = trader?.nickname || trader?.name;
    traderNames[id] = translate(traderEnglish, key) || id;
  }
  const items = [];
  for (const [id, raw] of Object.entries(rawItems)) {
    const name = translate(english, raw?.name),
      shortName = translate(english, raw?.shortName);
    if (!name || name === raw?.name || /^[a-f0-9]{24} Name$/i.test(name)) continue;
    const traderOffers = (raw.sellToTrader || [])
      .map(offer => ({
        trader: traderNames[offer.trader] || 'Trader',
        price: finitePrice(offer.priceRUB ?? offer.price)
      }))
      .filter(offer => offer.price !== null)
      .sort((a, b) => b.price - a.price);
    items.push({
      id: String(raw.id || id),
      name: name.slice(0, 180),
      shortName: (shortName || name).slice(0, 80),
      normalizedName: String(raw.normalizedName || ''),
      updated: raw.updated || raw.lastScan || null,
      width: Math.max(1, Number(raw.width) || 1),
      height: Math.max(1, Number(raw.height) || 1),
      avg24hPrice: finitePrice(raw.avg24hPrice),
      low24hPrice: finitePrice(raw.low24hPrice),
      high24hPrice: finitePrice(raw.high24hPrice),
      lastLowPrice: finitePrice(raw.lastLowPrice),
      changeLast48hPercent: Number.isFinite(Number(raw.changeLast48hPercent))
        ? Number(raw.changeLast48hPercent)
        : null,
      minLevelForFlea: finitePrice(raw.minLevelForFlea),
      types: Array.isArray(raw.types)
        ? raw.types.filter(type => typeof type === 'string').slice(0, 12)
        : [],
      bestTrader: traderOffers[0] || null,
      ...itemCategory(raw, handbookCategories, english)
    });
  }
  const newest = items
    .map(item => Date.parse(item.updated))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  return validateItemCatalog({
    format: 'raid-notes-items-v1',
    mode,
    source: 'tarkov.dev',
    generatedAt: new Date().toISOString(),
    pricesUpdatedAt: newest ? new Date(newest).toISOString() : null,
    items: items.sort((a, b) => a.name.localeCompare(b.name))
  });
}

function validateItemCatalog(doc) {
  if (
    !doc ||
    doc.format !== 'raid-notes-items-v1' ||
    !modeSlugs[doc.mode] ||
    !Array.isArray(doc.items) ||
    doc.items.length < 1000 ||
    doc.items.length > 7000
  )
    throw Error('Invalid item catalog');
  const ids = new Set();
  for (const item of doc.items) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !item.id ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      item.name.length > 180 ||
      typeof item.shortName !== 'string' ||
      item.shortName.length > 80 ||
      !Number.isFinite(item.width) ||
      !Number.isFinite(item.height)
    )
      throw Error('Invalid item entry');
    ids.add(item.id);
  }
  return doc;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[|]/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// In a raid the item name is printed in a small light font over the item's own
// picture, and the reading confuses characters that look alike far more often
// than it loses them: "Surv12" comes back as "Survi2", "M856A1" as "MB56A1".
// Folding those pairs together gives a second, slightly discounted chance at
// the name. Both sides are folded, so this only ever adds matches the plain
// comparison could not see.
function foldLookalikes(text) {
  return text.replace(/[il]/g, '1').replace(/o/g, '0').replace(/s/g, '5').replace(/b/g, '8');
}
// One side of a comparison, with everything that would otherwise be recomputed
// for each of the 5300 catalog items in turn. Scoring one phrase used to cost
// about 60 ms; measuring where it went found nothing but this repeated work.
function prepare(text) {
  const words = text ? text.split(' ') : [],
    grams = [],
    counts = new Map();
  for (let i = 0; i < text.length - 1; i++) {
    const gram = text.slice(i, i + 2);
    grams.push(gram);
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  return { text, length: text.length, words, wordSet: new Set(words), grams, counts };
}
// Sorensen-Dice over two-character shingles, counted on the way in.
function diceReady(expected, actual) {
  if (expected.text === actual.text) return 1;
  if (expected.length < 2 || actual.length < 2) return 0;
  const spent = new Map();
  let hits = 0;
  for (const gram of actual.grams) {
    const available = expected.counts.get(gram) || 0;
    if (!available) continue;
    const already = spent.get(gram) || 0;
    if (already < available) {
      hits++;
      spent.set(gram, already + 1);
    }
  }
  return (2 * hits) / (expected.length + actual.length - 2);
}
function scoreReady(expected, actual) {
  const a = expected.text,
    b = actual.text;
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 5 && b.includes(a)) return 0.9 + 0.1 * Math.min(1, a.length / b.length);
  if (b.length >= 5 && a.includes(b)) return 0.72 + 0.16 * Math.min(1, b.length / a.length);
  const coverage =
    expected.words.filter(word => actual.wordSet.has(word)).length / expected.words.length;
  return coverage * 0.62 + diceReady(expected, actual) * 0.38;
}
function phraseScore(expected, actual) {
  return scoreReady(prepare(normalizeText(expected)), prepare(normalizeText(actual)));
}

// The prepared form of a catalog, kept beside it rather than rebuilt per scan.
const catalogIndexes = new WeakMap();
function itemIndex(catalog) {
  const cached = catalogIndexes.get(catalog);
  if (cached) return cached;
  const index = catalog.items.map(item => {
    const short = normalizeText(item.shortName);
    return {
      item,
      name: prepare(normalizeText(item.name)),
      short: prepare(short),
      folded: prepare(foldLookalikes(short)),
      // Three characters are too few to match fuzzily, so such a short name has
      // to turn up as a whole word instead.
      shortWord:
        short.length === 3
          ? new RegExp('(?:^| )' + short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?: |$)')
          : null
    };
  });
  catalogIndexes.set(catalog, index);
  return index;
}
// A phrase to score the catalog against. `nearness` fades it by how far it sits
// from the cursor; text with no position is simply worth its full score.
function phraseOf(text, gap = null) {
  const normalized = normalizeText(text),
    ready = prepare(normalized);
  ready.folded = prepare(foldLookalikes(normalized));
  ready.gap = gap;
  ready.nearness = gap === null ? 1 : 1 / (1 + gap / cursorSpan);
  ready.source = text;
  return ready;
}
// `all` is the whole normalized text, if there is one: a name spread over lines
// that never sit next to each other is still that name.
function rankItems(catalog, phrases, limit, all, floor = nameFloor) {
  const results = [];
  for (const entry of itemIndex(catalog)) {
    let confidence = 0,
      score = 0,
      matched = '',
      gap = null;
    for (const phrase of phrases) {
      let current = scoreReady(entry.name, phrase);
      if (entry.short.length >= 4) {
        current = Math.max(current, scoreReady(entry.short, phrase) * 0.94);
        current = Math.max(current, scoreReady(entry.folded, phrase.folded) * 0.88);
      }
      // Three letters are never enough to be sure: misread text is full of
      // stray triples, and "EENGEL ERE)" once answered as an AR-15 receiver
      // extension. Scored below the threshold the scan treats as settled, so a
      // three-letter name always gets a second, wider look before it is
      // believed — which is also how a real "M67" survives being read as
      // "M67  4 FUERER".
      else if (entry.shortWord && entry.shortWord.test(phrase.text))
        current = Math.max(current, 0.72);
      if (entry.name.length >= 5 && phrase.text.includes(entry.name.text))
        current = Math.max(current, 0.99);
      const weighted = current * phrase.nearness;
      if (weighted > score) {
        score = weighted;
        confidence = current;
        matched = phrase.source;
        gap = phrase.gap;
      }
    }
    if (all && entry.name.length >= 5 && all.includes(entry.name.text) && score < 0.99) {
      score = 0.99;
      confidence = 0.99;
    }
    // Admission is on how well the name was read; distance only decides order.
    // Judging the faded score instead would drop a tooltip sitting a little way
    // from the cursor, which is exactly where the game puts one.
    if (confidence >= floor)
      results.push({
        ...entry.item,
        confidence: Number(confidence.toFixed(2)),
        score: Number(score.toFixed(4)),
        // How far from the cursor the text that named it sat, when the text
        // had a position at all.
        gap: gap === null ? null : Number(gap.toFixed(1)),
        matchedText: matched
      });
  }
  return results
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.avg24hPrice || 0) - (a.avg24hPrice || 0) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, Math.max(1, Math.min(10, limit)));
}
// Splits text into the phrases worth scoring: every line, and every line joined
// to the one after it, because a name can wrap.
function phraseTexts(lines) {
  const texts = [...lines];
  for (let i = 0; i < lines.length - 1; i++) texts.push(lines[i] + ' ' + lines[i + 1]);
  return texts;
}
function matchItemText(text, catalog, limit = 6) {
  validateItemCatalog(catalog);
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => normalizeText(line).length >= 3);
  return rankItems(
    catalog,
    phraseTexts(lines).map(phrase => phraseOf(phrase)),
    limit,
    normalizeText(text)
  );
}

// How quickly a name loses to a nearer one, in screen pixels. Roughly a row of
// inventory text: a name one row away is worth about half one under the cursor.
const cursorSpan = 24;
// How well a name has to be read before it is worth offering at all.
const nameFloor = 0.43;
// The widest crop can read well over a hundred lines off a busy screen, and
// scoring the catalog against each of them is what the user feels as a pause.
// Only the ones near the cursor can be the answer, so only those are scored.
const nearestLines = 48;

// An inventory tile carries its name along its top edge while the cursor sits
// in the middle of it, so the name of the tile below is about as far from the
// cursor as the tile's own name above. Distance alone cannot separate them.
// Text below the cursor is therefore charged several times over: interfaces
// label what is beneath the label, not what is above it.
const belowCost = 3;

// Distance from the cursor to a line's box, zero while the cursor is inside it.
function cursorGap(line) {
  const left = Number(line.left) || 0,
    right = Number(line.right) || 0,
    top = Number(line.top) || 0,
    bottom = Number(line.bottom) || 0,
    sideways = Math.max(0, left, -right),
    beneath = Math.max(0, top), // the line begins below the cursor
    above = Math.max(0, -bottom); // the line ends above the cursor
  return sideways + beneath * belowCost + above;
}

// Matches OCR lines that know where they sit relative to the cursor.
//
// The item hotkey crops a region centred on the pointer, so in a packed stash
// that crop holds several item names. Flattening them into one blob let any of
// them win: pointing at "AI-2 medkit" answered "Grizzly medical kit", because
// the longer name simply scored better. Tesseract reports a box per line, so
// which line the cursor is on is known; it only used to be thrown away.
//
// Each line carries its box in screen pixels with the cursor at the origin.
// `confidence` stays the plain text match, so the overlay still reports how
// well the name was read; `score` is that confidence faded by distance and is
// what the order means.
function matchItemLines(lines, catalog, limit = 6, floor = nameFloor) {
  validateItemCatalog(catalog);
  const usable = [];
  for (const line of lines || []) {
    const text = String(line?.text || '').trim();
    if (normalizeText(text).length >= 3)
      usable.push({
        text,
        gap: cursorGap(line),
        top: Number(line?.top) || 0,
        group: line?.group ?? 0
      });
  }
  if (!usable.length) return [];
  const near = usable.sort((a, b) => a.gap - b.gap).slice(0, nearestLines),
    phrases = near.map(line => phraseOf(line.text, line.gap));
  // A long name can wrap, so every line also competes joined to the one below
  // it in the same reading. The pair is only as near as its farther half,
  // otherwise a pair straddling the cursor would lend a neighbouring name the
  // cursor's own position.
  for (const group of new Set(near.map(line => line.group))) {
    const stacked = near.filter(line => line.group === group).sort((a, b) => a.top - b.top);
    for (let i = 0; i < stacked.length - 1; i++)
      phrases.push(
        phraseOf(
          stacked[i].text + ' ' + stacked[i + 1].text,
          Math.max(stacked[i].gap, stacked[i + 1].gap)
        )
      );
  }
  return rankItems(catalog, phrases, limit, null, floor);
}

module.exports = {
  modeSlugs,
  normalizeItemPayload,
  validateItemCatalog,
  matchItemText,
  matchItemLines,
  normalizeText,
  phraseScore
};
