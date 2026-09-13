const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { matchItemText, matchItemLines, validateItemCatalog, phraseScore } = require('../items.cjs');

// A stack of inventory rows about 25 screen pixels apart, with the cursor on
// the row at index `on`, as the item hotkey sees them.
function rows(names, on) {
  return names.map((text, index) => {
    const middle = (index - on) * 25;
    return { text, left: -57, right: 53, top: middle - 7, bottom: middle + 7 };
  });
}

test('bundled item price catalogs are resolved and structurally valid', () => {
  for (const mode of ['pvp', 'pve', 'seasonal']) {
    const file = path.join(__dirname, '../app/data/items-' + mode + '.json'),
      catalog = validateItemCatalog(JSON.parse(fs.readFileSync(file, 'utf8')));
    assert.ok(catalog.items.length >= 5000);
    assert.equal(new Set(catalog.items.map(item => item.id)).size, catalog.items.length);
    assert.ok(catalog.items.some(item => item.name === 'Graphics card' && item.avg24hPrice > 0));
    assert.ok(catalog.items.some(item => item.bestTrader?.trader && item.bestTrader.price > 0));
    assert.ok(catalog.items.every(item => !/[a-f0-9]{24} Name$/i.test(item.name)));
  }
});

test('item OCR matching ranks exact and mildly noisy names first', () => {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../app/data/items-pvp.json'), 'utf8')
  );
  const exact = matchItemText('INSPECT\nGraphics card\nWeight 0.6 kg', catalog, 3);
  assert.equal(exact[0].name, 'Graphics card');
  assert.equal(exact[0].confidence, 1);
  const noisy = matchItemText('ITEM\nIntelligence foIder\nFLEA MARKET', catalog, 3);
  assert.equal(noisy[0].name, 'Intelligence folder');
  assert.ok(noisy[0].confidence > 0.7);
  assert.ok(
    phraseScore('Colt M4A1 5.56x45 assault rifle', 'Colt M4A1 5.56x45 assault rifle') > 0.99
  );
});

test('the item hotkey picks the row under the cursor, not its neighbours', () => {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../app/data/items-pvp.json'), 'utf8')
  );
  const stack = [
    'AFAK tactical individual first ai',
    'AI-2 medkit (22)',
    'Car first aid kit (19)',
    'Grizzly medical kit (25)',
    'IFAK individual first aid kit (36)'
  ];
  // the same five rows read three times, pointing at a different one each time.
  // The blob matcher this replaced answered "Grizzly medical kit" every time.
  for (const [on, expected, neighbour] of [
    [1, 'AI-2 medkit', 'Car first aid kit'],
    [2, 'Car first aid kit', 'Grizzly medical kit'],
    [3, 'Grizzly medical kit', 'IFAK individual first aid kit']
  ]) {
    const found = matchItemLines(rows(stack, on), catalog, 10),
      other = found.find(match => match.name === neighbour);
    assert.equal(found[0].name, expected);
    assert.equal(found[0].gap, 0);
    // the row below is read just as well, and must still lose clearly on
    // position - it is charged extra for being below the cursor, because that
    // is where a tile's own name never is
    if (other) {
      assert.equal(other.confidence, found[0].confidence);
      assert.ok(other.score < found[0].score * 0.5);
    }
  }
  // a neighbouring row must not borrow the cursor's own position through the
  // joined pair that spans them both
  const caps = matchItemLines(
    rows(['Bandana (1)', 'Baseball cap (3)', 'Baseball cap (Boston) (1)'], 1),
    catalog,
    3
  );
  assert.equal(caps[0].name, 'Baseball cap');
});

test('a three-letter name is never reported as settled', () => {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../app/data/items-pvp.json'), 'utf8')
  );
  // what the OCR actually returned for a row reading "Bandana (1)", with the
  // cursor on it and a correctly read name one row below. The stray "ERE" wins
  // on position, but three letters are too few to believe, so it lands under
  // the confidence at which the scan stops widening.
  const found = matchItemLines(rows(['EENGEL ERE)', 'Baseball cap (3)'], 0), catalog, 5);
  assert.match(found[0].name, /Receiver Extension/);
  assert.ok(found[0].confidence < 0.76);
  // a real three-letter name read with junk beside it still survives
  const noisy = matchItemLines(rows(['M67  4 FUERER'], 0), catalog, 3);
  assert.equal(noisy[0].name, 'M67 hand grenade');
});

test('names lost to look-alike characters are still found', () => {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../app/data/items-pvp.json'), 'utf8')
  );
  // real readings from the user's in-raid gear screen: 1 became i, 8 became B
  assert.equal(
    matchItemLines(rows(['Survi2'], 0), catalog, 3)[0].name,
    'Surv12 field surgical kit'
  );
  assert.match(matchItemLines(rows(['MB56A1'], 0), catalog, 3)[0].name, /M856A1/);
});

test('a wrapped item name still matches, and confidence stays the text match', () => {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../app/data/items-pvp.json'), 'utf8')
  );
  const wrapped = matchItemLines(
    rows(['Salewa first aid', 'kit (12)', 'Weight 0.4 kg'], 0),
    catalog,
    3
  );
  assert.equal(wrapped[0].name, 'Salewa first aid kit');
  // distance fades the ranking score but never the reported read quality
  const far = matchItemLines(
    [{ text: 'Graphics card', left: 180, right: 290, top: 120, bottom: 134 }],
    catalog,
    3
  );
  assert.equal(far[0].name, 'Graphics card');
  assert.equal(far[0].confidence, 1);
  assert.ok(far[0].score < 0.2);
  assert.deepEqual(matchItemLines([], catalog, 3), []);
  assert.deepEqual(
    matchItemLines([{ text: '  ', left: 0, right: 9, top: 0, bottom: 9 }], catalog, 3),
    []
  );
});
