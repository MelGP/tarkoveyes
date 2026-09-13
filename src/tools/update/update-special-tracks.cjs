const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const overlay = JSON.parse(fs.readFileSync(path.join(root, 'fresh-overlay.json'), 'utf8'));
const itemEnvelope = JSON.parse(fs.readFileSync(path.join(root, 'fresh-items.json'), 'utf8'));
const english = JSON.parse(fs.readFileSync(path.join(root, 'fresh-items_en.json'), 'utf8')).data;
const rawItems = itemEnvelope.data.items;
const battlePassId = '6a35427afc3f27b15905a876';
const mapPatterns = [
  ['ground-zero', /ground zero/i],
  ['factory', /factory/i],
  ['customs', /customs/i],
  ['woods', /woods/i],
  ['shoreline', /shoreline/i],
  ['interchange', /interchange/i],
  ['the-labyrinth', /labyrinth/i],
  ['the-lab', /\b(?:the )?lab(?:s)?\b/i],
  ['reserve', /reserve/i],
  ['lighthouse', /lighthouse/i],
  ['streets-of-tarkov', /streets of tarkov/i],
  ['terminal', /terminal/i],
  ['icebreaker', /icebreaker/i]
];
function mapsFor(text) {
  return mapPatterns.filter(([, pattern]) => pattern.test(text || '')).map(([id]) => id);
}
const quests = Object.values(overlay.storyChapters)
  .sort((a, b) => a.order - b.order)
  .map(chapter => {
    const objectives = (chapter.objectives || []).map(objective => ({
      id: objective.id,
      description: objective.description,
      type: 'story',
      optional: objective.type === 'optional',
      mapIds: mapsFor(objective.description),
      details: [
        objective.type === 'optional' ? 'Optional story objective' : 'Main story objective'
      ],
      zones: [],
      requiredKeys: [],
      itemNames: [],
      sourceQuestId: objective.sourceQuestId || null
    }));
    const sourceQuestIds = [
        ...new Set(
          [chapter.chapterQuestId, ...objectives.map(objective => objective.sourceQuestId)].filter(
            Boolean
          )
        )
      ],
      mapIds = [...new Set(objectives.flatMap(objective => objective.mapIds))];
    return {
      id: 'story:' + chapter.id,
      name: chapter.name,
      traderId: 'story',
      traderName: 'Story',
      minPlayerLevel: 0,
      primaryMapId: mapIds[0] || null,
      mapIds,
      summary:
        chapter.description ||
        objectives
          .slice(0, 3)
          .map(objective => objective.description)
          .join(' · '),
      experience: 0,
      chainDepth: Math.max(0, chapter.order - 1),
      rewardSummary: [],
      objectives,
      requirements: [],
      neededKeys: [],
      category: 'story',
      storyChapterId: chapter.id,
      chapterQuestId: chapter.chapterQuestId || null,
      sourceQuestIds,
      wikiLink: chapter.wikiLink || null
    };
  });
const battleItems = Object.values(rawItems)
  .filter(item => (item.handbookCategories || []).includes(battlePassId))
  .sort((a, b) =>
    (english[a.name] || a.normalizedName).localeCompare(english[b.name] || b.normalizedName)
  );
quests.push({
  id: 'track:battle-pass-documents',
  name: 'Battle Pass · Documents',
  traderId: 'battle-pass',
  traderName: 'Battle Pass',
  minPlayerLevel: 0,
  primaryMapId: null,
  mapIds: [],
  summary: 'Track the document set used by the current Battle Pass.',
  experience: 0,
  chainDepth: 0,
  rewardSummary: [],
  objectives: battleItems.map(item => ({
    id: 'battle-pass:' + item.id,
    description: 'Collect ' + (english[item.name] || item.normalizedName),
    type: 'findItem',
    optional: false,
    mapIds: [],
    details: ['Battle Pass document'],
    zones: [],
    requiredKeys: [],
    itemNames: [english[item.name] || item.normalizedName],
    itemId: item.id
  })),
  requirements: [],
  neededKeys: [],
  category: 'battlepass',
  profiles: ['seasonal'],
  itemIds: battleItems.map(item => item.id)
});
const doc = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: 'https://github.com/tarkovtracker-org/tarkov-data-overlay',
  storyChapterCount: quests.filter(q => q.category === 'story').length,
  storyObjectiveCount: quests
    .filter(q => q.category === 'story')
    .reduce((n, q) => n + q.objectives.length, 0),
  battlePassItemCount: battleItems.length,
  quests
};
fs.writeFileSync(path.join(root, 'app/data/special-tracks.json'), JSON.stringify(doc));
for (const file of ['quests.json', 'quests-pve.json']) {
  const target = path.join(root, 'app/data', file),
    catalog = JSON.parse(fs.readFileSync(target));
  catalog.generatedAt = new Date().toISOString();
  catalog.sourceSnapshot = 'tarkov.dev 1.1.5 · 2026-09-10';
  fs.writeFileSync(target, JSON.stringify(catalog));
}
const regular = JSON.parse(fs.readFileSync(path.join(root, 'app/data/quests.json'))),
  seasonalRaw = JSON.parse(fs.readFileSync(path.join(root, 'fresh-seasonal.json'))),
  seasonalIds = new Set(Object.keys(seasonalRaw.data.tasks)),
  manualIds = new Set([
    '669fa3a1c26f13bd04030f37',
    '669fa394e0c9f9fafa082897',
    '6a880acc9216d0f5aa078305'
  ]);
const seasonal = {
  ...regular,
  gameMode: 'pvp-season',
  generatedAt: new Date().toISOString(),
  sourceSnapshot: 'tarkov.dev pvp-season 1.1.5 · 2026-09-10',
  quests: regular.quests.filter(quest => seasonalIds.has(quest.id) || manualIds.has(quest.id))
};
fs.writeFileSync(path.join(root, 'app/data/quests-seasonal.json'), JSON.stringify(seasonal));
console.log(
  doc.storyChapterCount +
    ' story chapters · ' +
    doc.storyObjectiveCount +
    ' objectives · ' +
    doc.battlePassItemCount +
    ' Battle Pass documents'
);
