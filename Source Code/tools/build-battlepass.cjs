const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sourceDir = path.join(__dirname, 'sources/battlepass');
const commit = '5aa75a875892d601276efeec29106960eca9594f';
const upstream =
  'https://raw.githubusercontent.com/Perofunyang/battlepass_interactive_map/' + commit + '/';

// Parse data literals, never evaluate downloaded JavaScript. Supports comments,
// trailing commas and plain template strings, but rejects executable expressions.
function parseLiteral(text) {
  let i = 0;
  function skip() {
    for (;;) {
      while (/\s/.test(text[i] || '') && i < text.length) i++;
      if (text.slice(i, i + 2) === '//') {
        while (i < text.length && text[i] !== '\n') i++;
      } else if (text.slice(i, i + 2) === '/*') {
        const end = text.indexOf('*/', i + 2);
        if (end < 0) throw Error('Unclosed comment');
        i = end + 2;
      } else break;
    }
  }
  function string() {
    const quote = text[i++];
    let value = '';
    while (i < text.length) {
      const char = text[i++];
      if (char === quote) return value;
      if (quote === '`' && char === '$' && text[i] === '{')
        throw Error('Template expressions are forbidden');
      if (char === '\\') {
        const next = text[i++];
        const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
        value += escapes[next] ?? next;
      } else value += char;
    }
    throw Error('Unclosed string');
  }
  function value() {
    skip();
    const char = text[i];
    if ('"\'`'.includes(char) && char) return string();
    if (char === '[' || char === '{') {
      i++;
      const array = char === '[',
        result = array ? [] : Object.create(null),
        close = array ? ']' : '}';
      skip();
      while (text[i] !== close) {
        if (array) result.push(value());
        else {
          skip();
          if (!'"\''.includes(text[i])) throw Error('Expected a quoted key');
          const key = string();
          if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('Unsafe key');
          skip();
          if (text[i++] !== ':') throw Error('Expected colon');
          result[key] = value();
        }
        skip();
        if (text[i] === close) break;
        if (text[i++] !== ',') throw Error('Expected comma at ' + i);
        skip();
      }
      i++;
      return result;
    }
    const match = text.slice(i).match(/^(?:-?\d+(?:\.\d+)?|true|false|null)\b/);
    if (!match) throw Error('Non-data expression at ' + i);
    i += match[0].length;
    return JSON.parse(match[0]);
  }
  const result = value();
  skip();
  if (text[i] === ';') i++;
  skip();
  if (i !== text.length) throw Error('Unexpected trailing expression');
  return result;
}
function parseMapData(text, key) {
  const prefix = new RegExp('^\\s*window\\.MAP_DATA_' + key + '\\s*=\\s*');
  if (!prefix.test(text)) throw Error('Unexpected map assignment: ' + key);
  return parseLiteral(text.replace(prefix, ''));
}
const documentIds = {
  blueprints: '6a31824878450ec91c0ea1ae',
  financial: '6a31807f17005505b70d5827',
  medical: '6a3182dc6cd8de21cf0a3a7d',
  pmc: '6a317b9692cfdcddcb02a58e',
  project: '6a3181f178450ec91c0ea1aa',
  technical: '6a31830dde69ceafd805afa0',
  test: '6a31828557705071410ca00e',
  user: '6a3182b72fd891345e047eef',
  classified: '6a3183258f113efdb7093622'
};
const labels = {
  blueprints: 'Blueprints',
  financial: 'Financial',
  medical: 'Medical',
  pmc: 'PMC files',
  project: 'Project',
  technical: 'Technical',
  test: 'Test',
  user: 'User',
  classified: 'Classified'
};
const colors = {
  blueprints: '#8bbfe4',
  financial: '#dfc879',
  medical: '#d5a4bc',
  pmc: '#b2c58b',
  project: '#e7b77e',
  technical: '#a6cfc8',
  test: '#b7a0dd',
  user: '#d7c9a4',
  classified: '#b8b8b8'
};
const aliases = {
  ground_zero: 'ground-zero',
  lab: 'the-lab',
  labyrinth: 'the-labyrinth',
  streets_of_tarkov: 'streets-of-tarkov'
};
// English renderings of the Korean location notes, kept beside the pinned
// sources so a rebuild never loses them. Keyed by map because point ids repeat
// across maps. Missing entries simply leave the point without an English note.
function noteTranslations() {
  const file = path.join(sourceDir, 'note-translations.json');
  if (!fs.existsSync(file)) return {};
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [map, notes] of Object.entries(doc.maps || {}))
    for (const [id, text] of Object.entries(notes))
      if (typeof text !== 'string' || !text.trim())
        throw Error('Empty translation: ' + map + '/' + id);
  return doc.maps || {};
}
function build() {
  const translations = noteTranslations();
  const sourceApp = fs.readFileSync(path.join(sourceDir, 'js-app.js'), 'utf8');
  const items = JSON.parse(fs.readFileSync(path.join(sourceDir, 'tarkov-items.json'))).data.items;
  const english = JSON.parse(fs.readFileSync(path.join(sourceDir, 'tarkov-items-en.json'))).data;
  const devMaps = JSON.parse(fs.readFileSync(path.join(sourceDir, 'tarkov-maps.json'))).data.maps;
  const categories = Object.fromEntries(
    Object.entries(documentIds).map(([key, id]) => {
      if (!items[id]?.handbookCategories.includes('6a35427afc3f27b15905a876'))
        throw Error('Unverified Battle Pass document: ' + id);
      return [
        key,
        {
          id,
          name: english[items[id].name],
          label: labels[key],
          color: colors[key],
          icon: 'assets/battlepass/icons/' + id + '.webp'
        }
      ];
    })
  );
  const maps = [],
    downloads = new Map();
  for (const match of sourceApp.matchAll(
    /^\s*(\w+): \{ name: "([^"]+)", imageUrl: "\.\/(assets\/maps\/[^\"]+)", width: (\d+), height: (\d+)/gm
  )) {
    const [, key, sourceName, imagePath, width, height] = match,
      id = aliases[key] || key;
    const w = Number(width),
      h = Number(height),
      rows = parseMapData(
        fs.readFileSync(path.join(sourceDir, 'data-' + key + '.js'), 'utf8'),
        key
      );
    const points = [],
      seen = new Set();
    for (const row of rows) {
      if (row.category === 'transit' || row.category === 'temporary') continue;
      if (!categories[row.category]) throw Error('Unknown document category: ' + row.category);
      if (
        !Array.isArray(row.coords) ||
        row.coords.length !== 2 ||
        !row.coords.every(Number.isFinite)
      )
        throw Error('Invalid coordinates: ' + row.id);
      const [sourceY, x] = row.coords,
        y = h - sourceY;
      if (x < 0 || x > w || y < 0 || y > h)
        throw Error('Point outside source image: ' + key + '/' + row.id);
      if (seen.has(row.id)) throw Error('Duplicate point ID: ' + key + '/' + row.id);
      seen.add(row.id);
      const photos = [
        ...new Set(
          [
            row.previewImg,
            ...(Array.isArray(row.detailImg) ? row.detailImg : [row.detailImg])
          ].filter(Boolean)
        )
      ];
      for (const photo of photos) {
        if (!/^assets\/previews\/[\w/-]+\.webp$/.test(photo))
          throw Error('Unsafe photo path: ' + photo);
        downloads.set('assets/battlepass/' + photo.slice(7), upstream + photo);
      }
      const note = (translations[id] || {})[row.id];
      points.push({
        id: row.id,
        category: row.category,
        x,
        y,
        sourceCoords: row.coords,
        approximate: /부정확/.test(row.detailDesc || ''),
        sourceNote: row.detailDesc || '',
        ...(note ? { note } : {}),
        photos: photos.map(photo => 'assets/battlepass/' + photo.slice(7))
      });
    }
    const image = 'assets/battlepass/maps/' + path.basename(imagePath);
    downloads.set(image, upstream + imagePath);
    maps.push({
      id,
      sourceKey: key,
      name: id === 'the-lab' ? 'The Lab' : id === 'the-labyrinth' ? 'The Labyrinth' : sourceName,
      width: w,
      height: h,
      image,
      points
    });
  }
  if (maps.length !== 12) throw Error('Expected 12 community maps');
  for (const category of Object.values(categories))
    downloads.set(category.icon, 'https://assets.tarkov.dev/' + category.id + '-icon.webp');
  const devSpawnCount = Object.values(devMaps).reduce(
    (count, map) =>
      count +
      (map.lootLoose || []).filter(point =>
        point.items.some(id => Object.values(documentIds).includes(id))
      ).length,
    0
  );
  const doc = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'https://perofunyang.github.io/battlepass_interactive_map/en.html',
    sourceCommit: commit,
    license: 'CC BY-NC 4.0',
    coordinateSystem: 'source-image-top-left',
    tarkovDevSource: 'https://json.tarkov.dev/regular/items',
    tarkovDevSpawnCount: devSpawnCount,
    categories,
    maps
  };
  fs.writeFileSync(path.join(root, 'app/data/battlepass-spawns.json'), JSON.stringify(doc));
  fs.writeFileSync(
    path.join(sourceDir, 'asset-downloads.json'),
    JSON.stringify([...downloads], null, 2)
  );
  const all = maps.flatMap(m => m.points);
  const translated = all.filter(p => p.note).length,
    withNote = all.filter(p => p.sourceNote.trim()).length;
  for (const [map, notes] of Object.entries(translations)) {
    const known = new Set((maps.find(m => m.id === map) || { points: [] }).points.map(p => p.id));
    for (const id of Object.keys(notes))
      if (!known.has(id))
        throw Error('Translation for a point that does not exist: ' + map + '/' + id);
  }
  console.log(
    JSON.stringify(
      {
        maps: maps.map(m => ({
          map: m.id,
          points: m.points.length,
          translated: m.points.filter(p => p.note).length
        })),
        total: all.length,
        approximate: all.filter(p => p.approximate).length,
        koreanNotes: withNote,
        englishNotes: translated,
        assets: downloads.size,
        tarkovDevSpawnCount: devSpawnCount
      },
      null,
      2
    )
  );
  return downloads;
}
async function downloadAssets(downloads) {
  const jobs = [...downloads];
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const [relative, url] = jobs[cursor++],
        target = path.join(root, 'app', relative);
      if (fs.existsSync(target) && fs.statSync(target).size > 100) continue;
      const response = await fetch(url);
      if (!response.ok) throw Error(response.status + ' ' + url);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 100) throw Error('Empty asset: ' + url);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log('All reference maps, document icons and spawn photographs are bundled.');
}
module.exports = { parseLiteral, parseMapData };
if (require.main === module) {
  const downloads = build();
  if (process.argv.includes('--download-assets'))
    downloadAssets(downloads).catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
