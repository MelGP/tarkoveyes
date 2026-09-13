const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { parseLiteral, parseMapData } = require('../tools/build-battlepass.cjs');
const root = path.resolve(__dirname, '../app'),
  doc = require('../app/data/battlepass-spawns.json');
test('Battle Pass source parser accepts data but rejects executable expressions', () => {
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        parseMapData(
          'window.MAP_DATA_factory = [{"id":"a", /* note */ "coords":[12, 34,],"note":`two\nlines`}];',
          'factory'
        )
      )
    ),
    [{ id: 'a', coords: [12, 34], note: 'two\nlines' }]
  );
  for (const input of [
    '{"x":process.exit()}',
    '{"x":`${process.exit()}`}',
    '[]; process.exit()',
    '{"__proto__":{}}',
    '{"x":new Image()}'
  ])
    assert.throws(() => parseLiteral(input));
});
test('Battle Pass locations preserve source positions and uncertainty across all 12 maps', () => {
  const counts = {
    customs: 30,
    factory: 30,
    'ground-zero': 31,
    interchange: 31,
    icebreaker: 32,
    'the-lab': 36,
    'the-labyrinth': 30,
    lighthouse: 31,
    reserve: 32,
    shoreline: 32,
    'streets-of-tarkov': 30,
    woods: 30
  };
  assert.equal(doc.coordinateSystem, 'source-image-top-left');
  assert.equal(doc.maps.length, 12);
  assert.equal(doc.tarkovDevSpawnCount, 0);
  assert.equal(doc.maps.flatMap(m => m.points).length, 375);
  assert.equal(doc.maps.flatMap(m => m.points).filter(p => p.approximate).length, 12);
  for (const map of doc.maps) {
    assert.equal(map.points.length, counts[map.id]);
    assert.equal(new Set(map.points.map(p => p.id)).size, map.points.length);
    const source = parseMapData(
      fs.readFileSync(
        path.join(__dirname, '../tools/sources/battlepass/data-' + map.sourceKey + '.js'),
        'utf8'
      ),
      map.sourceKey
    );
    for (const point of map.points) {
      const original = source.find(p => p.id === point.id);
      assert.ok(original);
      assert.deepEqual(point.sourceCoords, original.coords);
      assert.equal(point.x, original.coords[1]);
      assert.equal(point.y, map.height - original.coords[0]);
      assert.ok(point.x >= 0 && point.x <= map.width && point.y >= 0 && point.y <= map.height);
      assert.ok(doc.categories[point.category]);
      assert.equal(point.approximate, /부정확/.test(original.detailDesc || ''));
      assert.ok(point.photos.length > 0);
    }
  }
  const factory = doc.maps.find(m => m.id === 'factory'),
    anchor = factory.points.find(p => p.id === 'blueprint-3-1');
  assert.equal(anchor.x, 64);
  assert.equal(anchor.y, 270);
  assert.ok(!doc.maps.some(m => m.id === 'terminal'));
  assert.ok(
    !doc.maps.some(m =>
      m.points.some(p => ['transit', 'temporary', 'classified'].includes(p.category))
    )
  );
});
test('Every reference map, document icon and photograph is available locally', () => {
  assert.equal(Object.keys(doc.categories).length, 9);
  const assets = new Set(Object.values(doc.categories).map(c => c.icon));
  for (const map of doc.maps) {
    assets.add(map.image);
    for (const point of map.points) point.photos.forEach(p => assets.add(p));
  }
  assert.equal(assets.size, 461);
  for (const asset of assets) {
    assert.match(asset, /^assets\/battlepass\/[\w/.-]+$/);
    const file = path.resolve(root, asset);
    assert.ok(file.startsWith(root + path.sep));
    assert.ok(fs.statSync(file).size > 100, asset);
  }
});
test('Every community spawn has a bounded tactical placement and an existing floor', () => {
  const registration = require('../app/data/battlepass-placement.json'),
    maps = require('../app/data/maps.json');
  assert.equal(registration.coordinateSystem, 'normalized-tactical-artwork');
  assert.equal(registration.sourceCommit, doc.sourceCommit);
  for (const sourceMap of doc.maps) {
    const map = registration.maps.find(m => m.id === sourceMap.id),
      definition = maps.find(m => m.id === map.id);
    assert.deepEqual(
      map.points.map(p => p.id),
      sourceMap.points.map(p => p.id)
    );
    for (const p of map.points) {
      assert.ok(Number.isFinite(p.x) && p.x > 0 && p.x < 1);
      assert.ok(Number.isFinite(p.y) && p.y > 0 && p.y < 1);
      assert.ok(
        [definition.baseFloor.id, ...definition.floors.map(f => f.id)].includes(p.floor),
        map.id + '/' + p.id
      );
      assert.equal(p.alignment, 'approximate');
      assert.ok(p.floorLabel);
    }
  }
  const factory = registration.maps.find(m => m.id === 'factory');
  assert.equal(factory.points.filter(p => p.floor === 'Third_Floor').length, 8);
  assert.equal(factory.points.filter(p => p.floor === 'Basement').length, 4);
  assert.equal(factory.points.filter(p => p.floor === 'Ground_Floor').length, 15);
  const office = factory.points.find(p => p.id === 'blueprint-3-1');
  assert.ok(
    office.x > 0.18 && office.x < 0.25,
    'Source office inset must be relocated onto the actual office building'
  );
  const bunker = registration.maps
    .find(m => m.id === 'woods')
    .points.find(p => p.id === 'technical-2-1');
  assert.equal(bunker.region, 'mountain-bunker-entrance');
  assert.ok(
    bunker.x > 0.63 && bunker.x < 0.68 && bunker.y > 0.34 && bunker.y < 0.4,
    'Woods bunker inset must use its entrance leader, not its detached diagram position'
  );
});
test('Battle Pass controls target the existing tactical map without another map dialog', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
    script = fs.readFileSync(path.join(root, 'battlepass.js'), 'utf8');
  assert.match(html, /<g id="battlepass-markers"><\/g>/);
  assert.match(html, /id="layer-battlepass"/);
  assert.doesNotMatch(html, /id="bp-dialog"|id="bp-open"|id="bp-svg"/);
  assert.doesNotMatch(script, /battlepassAtlas|chooseMap|bp-map-image/);
  assert.match(script, /\$\('map-popup'\)/);
});
test('English location notes are attached to real points and the Korean original is kept', () => {
  const translations = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '../tools/sources/battlepass/note-translations.json'),
      'utf8'
    )
  );
  const hangul = /[ᄀ-ᇿ㄰-㆏가-힯]/;
  let declared = 0;
  for (const [mapId, notes] of Object.entries(translations.maps)) {
    const map = doc.maps.find(m => m.id === mapId);
    assert.ok(map, 'translation file names a map that exists: ' + mapId);
    for (const [id, text] of Object.entries(notes)) {
      const point = map.points.find(p => p.id === id);
      assert.ok(point, mapId + '/' + id + ' is translated but no such point exists');
      assert.ok(
        point.sourceNote.trim(),
        mapId + '/' + id + ' has a translation but no original note'
      );
      assert.equal(point.note, text, mapId + '/' + id + ' was not merged into the catalog');
      assert.ok(!hangul.test(text), mapId + '/' + id + ' translation still contains Hangul');
      declared++;
    }
  }
  const carried = doc.maps.flatMap(m => m.points).filter(p => p.note);
  assert.equal(carried.length, declared, 'every merged note comes from the translation file');
  for (const point of carried)
    assert.ok(point.sourceNote.trim(), point.id + ' lost its Korean original');
  const renderer = fs.readFileSync(path.join(root, 'battlepass.js'), 'utf8');
  assert.match(renderer, /point\.note/, 'the popup renders the English note');
  assert.match(renderer, /Korean/, 'the popup still offers the Korean original');
});
