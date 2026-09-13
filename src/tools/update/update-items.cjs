const fs = require('node:fs');
const path = require('node:path');
const { modeSlugs, normalizeItemPayload } = require('../../items.cjs');

async function get(pathname) {
  const response = await fetch('https://json.tarkov.dev/' + pathname, {
    headers: { accept: 'application/json', 'user-agent': 'RaidNotes item snapshot builder' }
  });
  if (!response.ok) throw Error(pathname + ' returned HTTP ' + response.status);
  const text = await response.text();
  if (text.length > 100 * 1024 * 1024) throw Error(pathname + ' response is too large');
  return JSON.parse(text);
}
async function update(mode) {
  const slug = modeSlugs[mode],
    [items, english, traders, traderEnglish] = await Promise.all([
      get(slug + '/items'),
      get(slug + '/items_en'),
      get(slug + '/traders'),
      get(slug + '/traders_en')
    ]),
    catalog = normalizeItemPayload(items, english, traders, traderEnglish, mode),
    target = path.join(__dirname, '../../app/data/items-' + mode + '.json');
  fs.writeFileSync(target, JSON.stringify(catalog));
  console.log(mode + ': ' + catalog.items.length + ' items -> ' + target);
}
(async () => {
  for (const mode of ['pvp', 'pve', 'seasonal']) await update(mode);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
