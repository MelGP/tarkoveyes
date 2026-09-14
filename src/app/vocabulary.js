/*
 * What the interface calls things.
 *
 * The tables and classifiers that turn catalogue data into a word or a shape:
 * which verb an objective is, which colour a quest wears, what counts as a
 * hazard zone, which marker outranks which when two want the same spot.
 *
 * None of it holds state or calls anything, which is why it is the first thing
 * to leave app.js - a feature module can import from here without importing
 * app.js back.
 */

export const questColors = [
  '#f4c980',
  '#83c8e8',
  '#e7a7bd',
  '#9bd4a8',
  '#c5aff0',
  '#f0a476',
  '#b6d989',
  '#8ecbc3'
];

export function objectiveTarget(o) {
  for (const detail of o.details || []) {
    const match = String(detail).match(/(?:required\s+count|count|required)\s*:?\s*(\d+)/i);
    if (match) return Math.max(1, Number(match[1]));
  }
  const match = String(o.description || '').match(
    /\b(?:kill|eliminate|find|obtain|hand over|place|plant|mark|stash|locate)\D{0,35}(\d+)\b/i
  );
  return match ? Math.max(1, Number(match[1])) : 1;
}

/* The same ternary was written out in three places and is about to be needed
 * in two more. */
export function modeLabel(mode) {
  return mode === 'seasonal' ? 'Seasonal/Kord Breach' : String(mode).toUpperCase();
}

export function questShape(q) {
  return [
    q.name,
    q.traderName,
    /* The faction belongs in the key. Without it the BEAR and USEC halves of
       Drip-Out and Textile are identical in every other field and collapse
       into each other - which deletes the very distinction the tag beside
       them exists to draw. */
    q.faction || '',
    [...(q.mapIds || [])].sort().join(','),
    (q.objectives || []).map(o => o.description).join('|')
  ].join('::');
}

export const statusRank = { completed: 3, active: 2, failed: 1, untracked: 0 };

export function objectiveMapCounts(objectives) {
  const counts = new Map();
  for (const o of objectives || []) {
    for (const z of o.zones || []) if (z.mapId) counts.set(z.mapId, (counts.get(z.mapId) || 0) + 1);
    for (const z of o.possibleLocations || [])
      if (z.mapId)
        counts.set(z.mapId, (counts.get(z.mapId) || 0) + Math.max(1, (z.positions || []).length));
  }
  return counts;
}

export const carryActions = {
  plantItem: 'Plant',
  plantQuestItem: 'Plant',
  giveItem: 'Hand in',
  giveQuestItem: 'Hand in',
  useItem: 'Use'
};

// Quest rows used to show initials. The portraits are bundled from tarkov.dev,
// but Story and Battle Pass tracks have no trader, and a file can go missing,
// so the initials stay as the fallback rather than leaving an empty square.
export function traderInitials(name) {
  return name
    .split(/s+/)
    .map(word => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/* A count is a circle. An objective is a pin. And the pin says what you do
 * there.
 *
 * Three different meanings were all drawn as a ring with a number in it -
 * which quest this is, how many objectives are stacked on this spot, and how
 * many loot points are nearby - so on Woods with the Valuables preset the
 * quest you opened the map for was indistinguishable from a pile of
 * screwdrivers behind it. The user reported it by pointing at two of them and
 * saying one is a quest and the other is not.
 *
 * The shape carries the meaning now. A pin is somewhere you are going, and
 * its tip is the coordinate, which is also more honest than a circle centred
 * on it. Everything that counts something keeps its circle.
 *
 * What went in the head is the more useful half. The number that used to sit
 * there was an index into My Raid, so it meant nothing at all unless that
 * panel happened to be open - while the thing the map could never tell you,
 * and that you go to the map for, is what the point is *for*. Counted over
 * every mapped objective in the catalogue, seven verbs cover all 964 points:
 * find 40%, visit 26%, plant 19%, mark 12%, shoot 2%, and nine stragglers -
 * eight signal flares and one extraction - that turned out to be two more
 * verbs rather than a remainder. So the glyph is the verb, the colour is
 * which quest, and the number moved to a badge. The dot is a fallback that
 * nothing in the bundled data reaches.
 *
 * The glyphs are not meant to be learned from a legend - the quest brief's
 * objective rows carry the same five, so the map and the list teach each
 * other. Keep them in step if either changes.
 *
 * The one other teardrop on the map is the user's own marker, and it is
 * deliberately unlike this one: a solid magenta drop with a hole punched in
 * it, centred on its point rather than standing on it. Do not give a third
 * layer a pin - the whole value here is that the silhouette is the answer.
 */
export const questPinPath =
  'M0 0 C-3 -6.9 -11 -11.6 -11 -20 A11 11 0 1 1 11 -20 C11 -11.6 3 -6.9 0 0 Z';

export const objectiveVerbs = {
  findQuestItem: 'find',
  findItem: 'find',
  visit: 'visit',
  mark: 'mark',
  plantItem: 'plant',
  plantQuestItem: 'plant',
  shoot: 'shoot',
  /* Every mapped `useItem` in all three catalogues is a signal flare - eight
     of them, from Airmail to the four in The Price of Independence - which is
     why the glyph is a flare rather than a generic "use something". If a
     catalogue refresh ever brings a useItem that is not a flare the glyph
     overstates it, though the objective text in the popup still says what it
     really is. Re-check with tools/ if that day comes. */
  useItem: 'signal',
  extract: 'extract'
};

export const verbLabels = {
  find: 'Pick something up here',
  visit: 'Go and look here',
  mark: 'Place a marker here',
  plant: 'Leave something here',
  shoot: 'Something to kill here',
  signal: 'Fire a signal flare here',
  extract: 'Leave the raid here',
  /* Not a verb but a state, and it belongs in the same table because it is
     drawn in the same place and has to be as distinct from the seven as they
     are from each other. */
  done: 'Already done'
};

export function objectiveVerb(objective) {
  return objectiveVerbs[objective && objective.type] || 'other';
}
/* Drawn in a box of about eleven units centred on the origin, so the caller
   places it and never has to know what a glyph is. Two to four strokes each:
   at the size a marker actually renders, a fifth stroke is a smudge. */

export const containerLayers = [
  ['medical', 'layer-container-medical', 'container-medical-count'],
  ['rations', 'layer-container-rations', 'container-rations-count'],
  ['technical', 'layer-container-technical', 'container-technical-count'],
  ['weapons', 'layer-container-weapons', 'container-weapons-count'],
  ['valuables', 'layer-container-valuables', 'container-valuables-count'],
  ['caches', 'layer-container-caches', 'container-caches-count']
];

/*
 * Deciding which marker gets the spot when two land on it.
 *
 * The map draws nine layers that know nothing about each other. On Customs with
 * all of them switched on that is 237 markers making 209 overlapping pairs -
 * very nearly one collision each - and because every layer draws at much the
 * same size, the one quest objective you opened the map for looked exactly like
 * a loose screwdriver behind it.
 *
 * Each layer clusters its own points already; what was missing was anything
 * deciding between layers. This ranks them once per render and quietens
 * whatever loses, rather than removing it: zoom in and the crowd separates, and
 * the marker comes back on its own.
 */
export const markerRanks = [
  ['player', 0],
  ['custom-markers', 1],
  ['markers', 2],
  ['boss-markers', 3],
  ['keycard-doors', 4],
  ['door-markers', 5],
  ['switch-markers', 5],
  ['battlepass-markers', 6],
  ['loot-markers', 8]
];
// Extracts share a layer with quest objectives but not their importance.

// Extracts share a layer with quest objectives but not their importance.
export const wayoutRank = 7;
// And an objective you have already finished has less than either.

// And an objective you have already finished has less than either.
export const doneRank = 9;
// One green for finished work, the same the quest brief strikes a line in.

// One green for finished work, the same the quest brief strikes a line in.
export const doneColor = '#82c7a7';

export const landmarksByMap = {
  customs: [
    ['DORMS', 201, 153],
    ['BIG RED', -204, -107],
    ['NEW GAS', 359, 53],
    ['OLD GAS', 309, -174],
    ['FORTRESS', 209, -137],
    ['CRACKHOUSE', 100, -107],
    ['CONSTRUCTION', 78, -8],
    ['RAIL BRIDGE', -110, -120],
    ['BOILERS', 570, -95]
  ],
  reserve: [
    ['WHITE QUEEN · DOME', -10, 180, '♕', 'white'],
    ['WHITE PAWN', -123, 96, '♙', 'white'],
    ['BLACK PAWN', -164, 53, '♟', 'black'],
    ['BLACK BISHOP', -136, -11, '♝', 'black'],
    ['WHITE BISHOP', -69, -32, '♗', 'white'],
    ['WHITE KING', -52, 21, '♔', 'white'],
    ['BLACK KNIGHT', 18, -15, '♞', 'black'],
    ['WHITE KNIGHT', 80, -37, '♘', 'white']
  ]
};
// Danger zones. The bundled tarkov.dev POIs carry an outline polygon for every
// minefield, sniper zone and mortar zone, and nothing drew them: 338 minefields
// on Lighthouse alone. They are painted straight onto the artwork, below every
// marker layer, and never take pointer events - a map covered in polygons that
// swallow drags would be worse than no map.

// Danger zones. The bundled tarkov.dev POIs carry an outline polygon for every
// minefield, sniper zone and mortar zone, and nothing drew them: 338 minefields
// on Lighthouse alone. They are painted straight onto the artwork, below every
// marker layer, and never take pointer events - a map covered in polygons that
// swallow drags would be worse than no map.
export const hazardKinds = [
  {
    type: 'minefield',
    key: 'hazardMinefield',
    control: 'layer-hazard-minefield',
    label: 'Minefield'
  },
  { type: 'sniper', key: 'hazardSniper', control: 'layer-hazard-sniper', label: 'Sniper zone' },
  { type: 'mortar', key: 'hazardMortar', control: 'layer-hazard-mortar', label: 'Mortar zone' },
  { type: 'hazard', key: 'hazardHazard', control: 'layer-hazard-hazard', label: 'Hazard' }
];

// The hand-placed landmark list only ever covered Customs and Reserve, so the
// Landmarks checkbox did nothing on the other eleven maps. Boss zones and BTR
// stops in the bundled POIs carry real place names ("Kaban · Car Dealership",
// "Rodina Cinema"), so the rest of the maps can be labelled from data. Names
// that read like internal identifiers are dropped rather than shown: Terminal
// and Icebreaker would otherwise be captioned 1BD1PortAmbush1 and Mash_t1.
export const internalLabel = /_|\d|[a-z][A-Z]/;
// Case matters for the camelCase test above, so the vague words get a separate
// case-insensitive regex: an /i flag on that one would make [a-z][A-Z] match any
// two letters and reject every name.

// Case matters for the camelCase test above, so the vague words get a separate
// case-insensitive regex: an /i flag on that one would make [a-z][A-Z] match any
// two letters and reject every name.
export const vagueLabel = /\b(spawn|ambush|snipe|zone|any)\b/i;

export function landmarkKey(name) {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
