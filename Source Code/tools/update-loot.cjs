const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'app/data/loot');
const itemAssets = path.join(root, 'app/assets/loot/items');
const categoryAssets = path.join(root, 'app/assets/loot/categories');
const mapDefinitions = require('../app/data/maps.json');
const existingItems = new Map(
  require('../app/data/items-pvp.json').items.map(item => [item.id, item])
);

const categoryDefinitions = {
  valuables: {
    label: 'Valuables+',
    handbookId: '5b47574386f77428ca22b2f1',
    icon: 'valuables.webp'
  },
  battlepass: {
    label: 'Battle Pass documents',
    handbookId: '6a35427afc3f27b15905a876',
    icon: 'battlepass.webp'
  },
  medical: { label: 'Medical', handbookId: '5b47574386f77428ca22b344', icon: 'medical.webp' },
  provisions: {
    label: 'Food & drinks',
    handbookId: '5b47574386f77428ca22b340',
    icon: 'provisions.webp'
  },
  technical: {
    label: 'Technical & barter',
    handbookId: '5b47574386f77428ca22b33e',
    icon: 'technical.webp'
  },
  keys: { label: 'Keys', handbookId: '5b47574386f77428ca22b342', icon: 'keys.webp' },
  weapons: {
    label: 'Weapons & ammo',
    handbookId: '5b5f78dc86f77409407a7f8e',
    icon: 'weapons.webp'
  },
  gear: { label: 'Gear', handbookId: '5b47574386f77428ca22b33f', icon: 'gear.webp' },
  task: { label: 'Quest & info items', handbookId: '5b47574386f77428ca22b341', icon: 'task.webp' },
  other: { label: 'Other loot', handbookId: '5b47574386f77428ca22b33e', icon: 'other.webp' }
};
const containerCategories = {
  medical: { label: 'Medical boxes', icon: 'container_medcase.png' },
  rations: { label: 'Ration boxes', icon: 'container_crate.png' },
  technical: { label: 'Technical boxes', icon: 'container_toolbox.png' },
  weapons: { label: 'Weapons & ammo', icon: 'container_weapon-box.png' },
  valuables: { label: 'Safes & valuables', icon: 'container_safe.png' },
  caches: { label: 'Stashes & general', icon: 'container_ground-cache.png' }
};
const containerLabels = {
  'bank-cash-register': 'Bank cash register',
  'bank-safe': 'Bank safe',
  'buried-barrel-cache': 'Buried barrel cache',
  'cash-register': 'Cash register',
  'civilian-body': 'Civilian body',
  'dead-scav': 'Dead Scav',
  drawer: 'Drawer',
  'duffle-bag': 'Duffle bag',
  'grenade-box': 'Grenade box',
  'ground-cache': 'Ground cache',
  jacket: 'Jacket',
  'lab-technician-body': 'Lab technician',
  medbag: 'Medbag SMU06',
  medcase: 'Medical case',
  'medical-supply-crate': 'Medical supply crate',
  'pc-block': 'PC block',
  'plastic-suitcase': 'Plastic suitcase',
  'pmc-body': 'PMC body',
  'ration-supply-crate': 'Ration supply crate',
  safe: 'Safe',
  'scav-body': 'Scav body',
  'shturmans-stash': "Shturman's stash",
  'technical-supply-crate': 'Technical supply crate',
  toolbox: 'Toolbox',
  'weapon-box': 'Weapon box',
  'wooden-ammo-box': 'Wooden ammo box',
  'wooden-crate': 'Wooden crate',
  'opened-technical-supply-crate': 'Opened technical supply crate',
  'unlocked-medical-supply-crate': 'Unlocked medical supply crate',
  'unlocked-ration-supply-crate': 'Unlocked ration supply crate',
  'unlocked-wooden-crate': 'Unlocked wooden crate',
  'usec-body': 'USEC body',
  'box-with-supplies-for-rogues': 'Rogue supply box',
  'case-with-goods-for-smugglers': 'Smuggler goods case',
  'carbon-fiber-case': 'Carbon fiber case'
};
const containerIcons = {
  'bank-cash-register': 'container_cash-register.png',
  'bank-safe': 'container_safe.png',
  'buried-barrel-cache': 'container_buried-barrel-cache.png',
  'cash-register': 'container_cash-register.png',
  'civilian-body': 'container_dead-scav.png',
  'dead-scav': 'container_dead-scav.png',
  drawer: 'container_drawer.png',
  'duffle-bag': 'container_duffle-bag.png',
  'grenade-box': 'container_grenade-box.png',
  'ground-cache': 'container_ground-cache.png',
  jacket: 'container_jacket.png',
  'lab-technician-body': 'container_dead-scav.png',
  medbag: 'container_medbag-smu06.png',
  medcase: 'container_medcase.png',
  'medical-supply-crate': 'container_crate.png',
  'pc-block': 'container_pc-block.png',
  'plastic-suitcase': 'container_plastic-suitcase.png',
  'pmc-body': 'container_dead-scav.png',
  'ration-supply-crate': 'container_crate.png',
  safe: 'container_safe.png',
  'scav-body': 'container_dead-scav.png',
  'shturmans-stash': 'container_weapon-box.png',
  'technical-supply-crate': 'container_crate.png',
  toolbox: 'container_toolbox.png',
  'weapon-box': 'container_weapon-box.png',
  'wooden-ammo-box': 'container_wooden-ammo-box.png',
  'wooden-crate': 'container_wooden-crate.png'
};
const sourceMaps = {
  factory: ['factory', 'night-factory'],
  'ground-zero': ['ground-zero', 'ground-zero-21']
};
const top = {
  barter: '5b47574386f77428ca22b33e',
  battlepass: '6a35427afc3f27b15905a876',
  valuables: '5b47574386f77428ca22b2f1',
  medical: '5b47574386f77428ca22b344',
  medicalSupplies: '5b47574386f77428ca22b2f3',
  provisions: '5b47574386f77428ca22b340',
  keys: '5b47574386f77428ca22b342',
  weapons: '5b5f78dc86f77409407a7f8e',
  ammo: '5b47574386f77428ca22b346',
  mods: '5b5f71a686f77447ed5636ab',
  gear: '5b47574386f77428ca22b33f',
  task: '5b5f740a86f77447ec5d7706',
  info: '5b47574386f77428ca22b341',
  special: '5b47574386f77428ca22b345'
};
function rounded(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
function inside(position, definition) {
  const [[x1, z1], [x2, z2]] = definition.bounds,
    margin = 2;
  return (
    position &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z) &&
    position.x >= Math.min(x1, x2) - margin &&
    position.x <= Math.max(x1, x2) + margin &&
    position.z >= Math.min(z1, z2) - margin &&
    position.z <= Math.max(z1, z2) + margin
  );
}
function ancestors(ids, categories) {
  const result = new Set(ids || []);
  for (const id of [...result]) {
    let current = categories[id];
    while (current?.parent && !result.has(current.parent)) {
      result.add(current.parent);
      current = categories[current.parent];
    }
  }
  return result;
}
function primaryLooseCategory(raw, categories) {
  const ids = ancestors(raw?.handbookCategories, categories),
    types = new Set(raw?.types || []),
    has = (...values) => values.some(id => ids.has(id)),
    typed = (...values) => values.some(type => types.has(type));
  if (has(top.medical, top.medicalSupplies) || typed('meds', 'injectors')) return 'medical';
  if (has(top.provisions) || typed('provisions')) return 'provisions';
  if (has(top.keys) || typed('keys')) return 'keys';
  if (has(top.weapons, top.ammo, top.mods) || typed('gun', 'ammo', 'ammoBox', 'mods', 'grenade'))
    return 'weapons';
  if (
    has(top.gear) ||
    typed('armor', 'armorPlate', 'backpack', 'glasses', 'headphones', 'helmet', 'rig', 'wearable')
  )
    return 'gear';
  if (has(top.task, top.info, top.special, top.battlepass)) return 'task';
  if (has(top.barter) || typed('barter')) return 'technical';
  return 'other';
}
function looseCategories(raw, value, categories) {
  const ids = ancestors(raw?.handbookCategories, categories),
    result = [primaryLooseCategory(raw, categories)];
  if (ids.has(top.battlepass)) result.push('battlepass');
  if (ids.has(top.valuables) || value >= 100000) result.push('valuables');
  return [...new Set(result)];
}
function containerCategory(type) {
  if (/medical|medbag|medcase/.test(type)) return 'medical';
  if (/ration/.test(type)) return 'rations';
  if (/technical|toolbox|pc-block/.test(type)) return 'technical';
  if (/weapon|ammo|grenade|shturman/.test(type)) return 'weapons';
  if (/safe|cash-register|drawer|carbon-fiber/.test(type)) return 'valuables';
  return 'caches';
}
function containerIcon(type, category) {
  return containerIcons[type] || containerCategories[category].icon;
}
async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'RaidNotes loot snapshot builder' }
  });
  if (!response.ok) throw Error(url + ' returned HTTP ' + response.status);
  return response.json();
}
async function download(url, target) {
  if (fs.existsSync(target) && fs.statSync(target).size > 100) return false;
  const response = await fetch(url);
  if (!response.ok) throw Error(url + ' returned HTTP ' + response.status);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  return true;
}
async function downloadIcons(ids) {
  const jobs = ids.map(id => [
    'https://assets.tarkov.dev/' + id + '-icon.webp',
    path.join(itemAssets, id + '.webp')
  ]);
  for (const def of Object.values(categoryDefinitions))
    jobs.push([
      'https://assets.tarkov.dev/handbook-category-' + def.handbookId + '-icon.webp',
      path.join(categoryAssets, def.icon)
    ]);
  let cursor = 0,
    downloaded = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const [url, target] = jobs[cursor++];
      if (await download(url, target)) downloaded++;
    }
  }
  await Promise.all(Array.from({ length: 10 }, worker));
  return downloaded;
}
async function main() {
  const arg = name => {
      const i = process.argv.indexOf(name);
      return i >= 0 ? process.argv[i + 1] : null;
    },
    mapsFile = arg('--maps-file'),
    itemsFile = arg('--items-file'),
    englishFile = arg('--items-en-file');
  const raw = mapsFile
    ? JSON.parse(fs.readFileSync(path.resolve(root, mapsFile), 'utf8'))
    : await fetchJson('https://json.tarkov.dev/regular/maps');
  const itemEnvelope = itemsFile
    ? JSON.parse(fs.readFileSync(path.resolve(root, itemsFile), 'utf8'))
    : await fetchJson('https://json.tarkov.dev/regular/items');
  const englishEnvelope = englishFile
    ? JSON.parse(fs.readFileSync(path.resolve(root, englishFile), 'utf8'))
    : await fetchJson('https://json.tarkov.dev/regular/items_en');
  const maps = raw.data?.maps || raw.maps,
    containerTypes = raw.data?.lootContainers || raw.lootContainers,
    rawItems = itemEnvelope.data?.items || {},
    categories = itemEnvelope.data?.handbookCategories || {},
    english = englishEnvelope.data || {};
  if (!maps || !containerTypes || !Object.keys(rawItems).length)
    throw Error('Unexpected tarkov.dev snapshot');
  const apiMaps = Object.values(maps),
    referencedItems = new Set();
  fs.mkdirSync(output, { recursive: true });
  let totalContainers = 0,
    totalLoose = 0;
  for (const definition of mapDefinitions) {
    const names = sourceMaps[definition.id] || [definition.id],
      sources = apiMaps.filter(map => names.includes(map.normalizedName)),
      typeDoc = {},
      containers = [],
      loose = [],
      seenContainers = new Set(),
      seenLoose = new Set();
    for (const map of sources) {
      for (const entry of map.lootContainers || []) {
        if (!inside(entry.position, definition)) continue;
        const sourceType = containerTypes[entry.lootContainer],
          type = sourceType?.normalizedName;
        if (!type) continue;
        const key = [
          type,
          rounded(entry.position.x),
          rounded(entry.position.y),
          rounded(entry.position.z)
        ].join(':');
        if (seenContainers.has(key)) continue;
        seenContainers.add(key);
        const category = containerCategory(type);
        typeDoc[type] = {
          label: containerLabels[type] || type.replaceAll('-', ' '),
          icon: containerIcon(type, category),
          category
        };
        containers.push([
          rounded(entry.position.x),
          rounded(entry.position.y),
          rounded(entry.position.z),
          type
        ]);
      }
      for (const entry of map.lootLoose || []) {
        if (!inside(entry.position, definition)) continue;
        const ids = [...new Set((entry.items || []).filter(id => rawItems[id]))].sort();
        if (!ids.length) continue;
        const key = [
          rounded(entry.position.x),
          rounded(entry.position.y),
          rounded(entry.position.z),
          ids.join(',')
        ].join(':');
        if (seenLoose.has(key)) continue;
        seenLoose.add(key);
        ids.forEach(id => referencedItems.add(id));
        const entryCategories = [
          ...new Set(
            ids.flatMap(id => {
              const rawItem = rawItems[id],
                old = existingItems.get(id),
                value = Math.max(
                  rawItem.avg24hPrice || 0,
                  rawItem.lastLowPrice || 0,
                  old?.avg24hPrice || 0,
                  old?.bestTrader?.price || 0
                );
              return looseCategories(rawItem, value, categories);
            })
          )
        ].sort();
        loose.push([
          rounded(entry.position.x),
          rounded(entry.position.y),
          rounded(entry.position.z),
          ids,
          entryCategories
        ]);
      }
    }
    const usedIds = new Set(loose.flatMap(entry => entry[3])),
      items = {};
    for (const id of usedIds) {
      const rawItem = rawItems[id],
        old = existingItems.get(id),
        value = Math.max(
          rawItem.avg24hPrice || 0,
          rawItem.lastLowPrice || 0,
          old?.avg24hPrice || 0,
          old?.bestTrader?.price || 0
        ),
        categoryKeys = looseCategories(rawItem, value, categories),
        categoryKey = categoryKeys[0];
      items[id] = {
        name: english[rawItem.name] || old?.name || id,
        shortName: english[rawItem.shortName] || old?.shortName || '',
        category: categoryDefinitions[categoryKey].label,
        categoryKey,
        categoryKeys,
        value,
        handbookCategories: rawItem.handbookCategories || []
      };
    }
    const document = {
      schemaVersion: 3,
      mapId: definition.id,
      source: 'https://json.tarkov.dev/regular/maps',
      sources: [
        'https://json.tarkov.dev/regular/maps',
        'https://json.tarkov.dev/regular/items',
        'https://json.tarkov.dev/regular/items_en'
      ],
      generatedAt: new Date().toISOString(),
      categories: categoryDefinitions,
      containerCategories,
      containerTypes: typeDoc,
      items,
      containers,
      loose
    };
    fs.writeFileSync(path.join(output, definition.id + '.json'), JSON.stringify(document));
    totalContainers += containers.length;
    totalLoose += loose.length;
    console.log(
      definition.id +
        ': ' +
        containers.length +
        ' containers, ' +
        loose.length +
        ' loose-loot points'
    );
  }
  let downloaded = 0;
  if (process.argv.includes('--download-icons'))
    downloaded = await downloadIcons([...referencedItems]);
  console.log(
    'Total: ' +
      totalContainers +
      ' containers, ' +
      totalLoose +
      ' loose-loot points, ' +
      referencedItems.size +
      ' item icons (' +
      downloaded +
      ' downloaded)'
  );
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
