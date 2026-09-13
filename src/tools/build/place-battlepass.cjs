// Community image-to-map registration. All placements are explicitly approximate.
// Coordinates below are in a 1000 x 1000 normalized artwork space, not game units.
// Insets are registered independently; stretching the full montage is never used.
const fs = require('node:fs'),
  path = require('node:path');
const source = require('../../app/data/battlepass-spawns.json');
const defs = require('../../app/data/maps.json');
function affine(a, b, c) {
  const [x1, y1, u1, v1] = a,
    [x2, y2, u2, v2] = b,
    [x3, y3, u3, v3] = c,
    det = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
  if (!det) throw Error('Collinear anchors');
  return (x, y) => {
    const s = ((x - x1) * (y3 - y1) - (y - y1) * (x3 - x1)) / det,
      t = ((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)) / det;
    return [u1 + s * (u2 - u1) + t * (u3 - u1), v1 + s * (v2 - v1) + t * (v3 - v1)];
  };
}
function rect(x, y, from, to) {
  return [
    to[0] + ((x - from[0]) / (from[2] - from[0])) * (to[2] - to[0]),
    to[1] + ((y - from[1]) / (from[3] - from[1])) * (to[3] - to[1])
  ];
}
const anchors = {
  factory: [
    [177, 30, 194, 45],
    [676, 30, 743, 45],
    [354, 543, 391, 572]
  ],
  customs: [
    [850, 300, 852, 365],
    [450, 794, 458, 870],
    [270, 330, 287, 400]
  ],
  'ground-zero': [
    [246, 130, 235, 95],
    [455, 210, 704, 199],
    [466, 800, 731, 954]
  ],
  interchange: [
    [264, 265, 497, 156],
    [420, 265, 784, 156],
    [264, 750, 497, 747]
  ],
  'the-lab': [
    [450, 390, 385, 32],
    [580, 690, 727, 606],
    [350, 840, 122, 893]
  ],
  'the-labyrinth': [
    [256, 150, 195, 97],
    [616, 536, 591, 502],
    [595, 798, 568, 780]
  ],
  lighthouse: [
    [448, 300, 442, 277],
    [657, 273, 654, 244],
    [600, 675, 596, 672]
  ],
  reserve: [
    [265, 510, 353, 434],
    [420, 514, 576, 540],
    [430, 823, 505, 832]
  ],
  shoreline: [
    [400, 477, 485, 317],
    [384, 678, 466, 582],
    [545, 250, 659, 50]
  ],
  'streets-of-tarkov': [
    [543, 365, 514, 365],
    [547, 593, 514, 607],
    [440, 111, 328, 108]
  ],
  woods: [
    [448, 631, 430, 641],
    [814, 390, 815, 389],
    [395, 185, 378, 169]
  ]
};
const floorNames = {
  Ground_Level: 'Ground / Main',
  Ground_Floor: 'Ground / Main',
  Second_Floor: '2nd Floor',
  Third_Floor: '3rd Floor',
  Basement: 'Tunnels',
  Underground_Level: 'Underground',
  First_Floor: 'Mall · 1st Floor',
  Second_Level: 'Second Level',
  First_Level: 'First Level',
  Bunkers: 'Bunkers'
};
function placement(map, p) {
  const d = defs.find(d => d.id === map.id),
    x = (p.x / map.width) * 1000,
    y = (p.y / map.height) * 1000,
    parts = p.id.split('-'),
    nums = parts.slice(1).map(Number);
  let pos,
    level = d.baseFloor.id,
    label = 'Ground / Main',
    region = 'main';
  const main = anchors[map.id] && affine(...anchors[map.id]);
  const box = (from, to, name, f) => {
    pos = rect(x, y, from, to);
    region = name;
    if (f) level = f;
  };
  const local = (from, to, name, f) => {
    pos = main(...rect(x, y, from, to));
    region = name;
    if (f) level = f;
  };
  if (map.id === 'factory') {
    level = { 0: 'Basement', 1: 'Ground_Floor', 2: 'Second_Floor', 3: 'Third_Floor' }[nums[0]];
    if (nums[0] === 3) {
      pos = main(x + 100, y);
      region = 'office-third-floor';
    } else if (nums[0] === 2 && x > 780) {
      pos = main(x - 190, y);
      region = 'eastern-second-floor';
    }
  } else if (map.id === 'customs') {
    level =
      { 0: 'Underground_Level', 1: 'Ground_Level', 2: 'Second_Floor', 3: 'Third_Floor' }[nums[2]] ||
      level;
    if (nums[0] === 5) {
      if (nums[1] === 1) {
        const from = nums[2] === 3 ? [774, 770, 819, 989] : [850, 770, 900, 989];
        box(from, [466, 809, 502, 894], 'three-storey-dorms', level);
      } else {
        const from = nums[2] === 2 ? [607, 780, 653, 989] : [660, 780, 710, 989];
        box(from, [425, 796, 448, 881], 'two-storey-dorms', level);
      }
    } else if (nums[0] === 2 && nums[1] === 1 && y < 160)
      box([558, 0, 595, 150], [445, 276, 487, 381], 'fortress-floor-plan', level);
    else if (nums[0] === 2 && nums[1] === 2)
      box([623, 55, 655, 135], [563, 520, 587, 559], 'crackhouse-second-floor', level);
    else if (nums[0] === 3 && nums[1] === 1 && y > 580)
      box([890, 597, 990, 689], [830, 239, 872, 396], 'big-red-office', level);
    else if (nums[0] === 1 && nums[1] === 3 && x < 240)
      box([210, 66, 251, 225], [249, 379, 295, 505], 'warehouse-second-floor', level);
  } else if (map.id === 'ground-zero') {
    if (nums[0] === 8) {
      box([844, 120, 912, 530], [664, 151, 821, 633], 'underground-corridor', 'Underground_Level');
    } else if (nums[0] === 3 && nums[1] === 2)
      box([617, 321, 688, 405], [725, 188, 884, 318], 'terragroup-second-floor', 'Second_Floor');
    else if (nums[0] === 1 && nums[1] === 2)
      local([70, 398, 127, 448], [264, 399, 322, 449], 'fusion-cafe-upper', 'Second_Floor');
    else if (nums[0] === 4 && nums[1] === 2 && x < 150)
      local([74, 476, 125, 581], [278, 481, 330, 586], 'fusion-second-floor', 'Second_Floor');
    else if (nums[0] === 5 && nums[2] === 3)
      local([517, 535, 568, 586], [427, 487, 478, 538], 'empire-upper-floor', 'Second_Floor');
    else if (nums[0] === 2 && nums[1] === 5)
      local([617, 321, 688, 405], [440, 170, 511, 254], 'terragroup-lobby', 'Ground_Level');
  } else if (map.id === 'interchange') {
    if (nums[0] === 1) {
      box([738, 275, 867, 747], [490, 177, 763, 720], 'mall-first-floor', 'First_Floor');
    } else if (nums[0] === 2)
      box([904, 397, 990, 620], [490, 328, 687, 603], 'mall-second-floor', 'Second_Floor');
    else if (x > 900 && y < 780)
      box([916, 680, 980, 765], [799, 84, 831, 183], 'power-station', 'Ground_Level');
    else if (x > 900)
      box([923, 785, 964, 841], [799, 97, 831, 160], 'power-station-basement', 'Ground_Level');
  } else if (map.id === 'the-lab') {
    if (x > 650) {
      box([745, 115, 897, 421], [385, 198, 788, 786], 'lab-second-level', 'Second_Level');
    } else if (x < 340 && y > 800)
      box([294, 839, 327, 950], [100, 892, 132, 958], 'containment-wing', 'First_Level');
    else {
      level = 'First_Level';
      region = 'lab-first-level';
    }
  } else if (map.id === 'lighthouse') {
    label = nums[2] ? nums[2] + 'F' : 'Ground / Main';
    if (nums[0] === 2 && nums[1] === 1 && x < 100)
      local([30, 184, 63, 224], [430, 282, 463, 322], 'water-treatment-west-upper');
    else if (nums[0] === 2 && nums[1] === 2 && x < 200)
      local([133, 204, 203, 227], [541, 228, 611, 250], 'water-treatment-north-roof');
    else if (nums[0] === 2 && nums[1] === 3 && x < 300)
      local([220, 183, 252, 224], [640, 257, 672, 298], 'water-treatment-east-upper');
    else if (nums[0] === 3 && x > 900) {
      const base = nums[1] === 6 ? 657 : 611;
      local(
        [nums[1] === 6 ? 966 : 916, 522, nums[1] === 6 ? 987 : 943, 552],
        [base, 493, base + 24, 523],
        'village-upper-floor'
      );
    } else if (nums[0] === 4 && nums[1] === 1 && x > 750)
      local(
        [x > 810 ? 810 : 779, 598, x > 810 ? 837 : 806, 631],
        [549, 562, 576, 595],
        'cottage-upper-floor'
      );
    else if (nums[0] === 4 && nums[1] === 4)
      local([849, 593, 883, 621], [585, 546, 619, 574], 'cottage-annex-upper');
    else if (nums[0] === 4 && nums[1] === 3)
      local([244, 772, 270, 794], [352, 767, 378, 789], 'sunken-house-upper');
  } else if (map.id === 'reserve') {
    label = nums[2] === 0 ? 'Underground' : nums[2] ? nums[2] + 'F' : 'Ground / Main';
    if (nums[0] === 4 && nums[1] === 1)
      box([79, 780, 112, 850], [324, 402, 381, 468], 'white-knight-third-floor');
    else if (nums[0] === 4 && nums[1] === 3)
      box([73, 895, 104, 970], [428, 434, 486, 494], 'black-knight-third-floor');
    else if (nums[0] === 4 && nums[1] === 7)
      box([181, 895, 241, 990], [550, 493, 614, 565], 'white-king-third-floor');
    else if (nums[0] === 5 && nums[1] === 1 && nums[2] === 0)
      box([892, 74, 962, 121], [668, 414, 747, 462], 'black-bishop-basement', 'Bunkers');
    else if (nums[0] === 5 && nums[1] === 1) {
      const fy = nums[2] === 3 ? 771 : 843;
      box([808, fy, 884, fy + 57], [654, 418, 745, 475], 'black-bishop-upper');
    } else if (nums[0] === 5 && nums[1] === 2) {
      const sx = { 2: 877, 3: 900, 4: 926 }[nums[2]];
      box([sx, 639, sx + 25, 738], [744, 533, 778, 661], 'black-pawn-upper');
    } else if (nums[0] === 5 && nums[1] === 3) {
      const fy = nums[2] === 4 ? 802 : 883;
      box([917, fy - 10, 975, fy + 23], [655, 629, 735, 670], 'white-pawn-upper');
    } else if (nums[0] === 6 && nums[1] === 1)
      box([679, 754, 714, 847], [487, 799, 526, 870], 'dome-upper');
    else if (nums[0] === 8 && nums[1] === 3)
      box([858, 379, 911, 411], [546, 770, 605, 799], 'd2-office', 'Bunkers');
    else if (nums[0] === 8)
      box([889, 149, 973, 255], [641, 493, 751, 624], 'command-bunker', 'Bunkers');
  } else if (map.id === 'shoreline') {
    if (nums[0] === 2 && nums[1] === 1) {
      const third = nums[2] >= 300 || nums[2] === 3;
      box(
        third ? [758, 270, 950, 362] : [771, 355, 962, 450],
        [412, 297, 501, 349],
        'resort-west',
        third ? 'Third_Floor' : 'Second_Floor'
      );
    } else if (nums[0] === 2 && y < 160)
      box([526, 65, 614, 139], [471, 239, 503, 293], 'resort-admin', 'Second_Floor');
    else if (nums[0] === 2 && nums[1] === 3) {
      const third = nums[2] >= 300 || nums[2] === 3;
      box(
        third ? [797, 710, 989, 813] : [779, 803, 979, 903],
        [487, 299, 558, 348],
        'resort-east',
        third ? 'Third_Floor' : 'Second_Floor'
      );
    } else if (nums[0] === 8 && nums[1] === 1) {
      label = nums[2] + 'F';
    }
  } else if (map.id === 'streets-of-tarkov') {
    level = nums[2] === 2 ? 'Second_Floor' : nums[2] === 3 ? 'Third_Floor' : level;
    if (nums[0] === 1 && nums[1] === 3)
      local([237, 270, 289, 340], [423, 270, 475, 340], 'cardinal-apartments-upper', level);
    else if (nums[0] === 5 && nums[1] === 1 && nums[2] === 2)
      local([800, 453, 871, 489], [560, 413, 631, 449], 'pinewood-upper', level);
    else if (nums[0] === 7 && nums[1] === 6)
      local([149, 923, 208, 980], [352, 732, 411, 789], 'concordia-upper', level);
    else if (nums[0] === 7 && nums[1] === 7 && nums[2] === 2)
      local([283, 846, 308, 892], [476, 668, 501, 714], 'concordia-annex-upper', level);
    else if (nums[0] === 8 && nums[1] === 1 && nums[2] === 2)
      local([796, 675, 819, 690], [683, 580, 706, 595], 'financial-office-upper', level);
  } else if (map.id === 'woods' && p.id === 'technical-2-1') {
    // The source inset's dashed leader ends at the mountain bunker entrance
    // (4633, 2527 in the 6994 x 6843 source image). No underground artwork exists.
    pos = main((4633 / 6994) * 1000, (2527 / 6843) * 1000);
    region = 'mountain-bunker-entrance';
    label = 'Underground · mountain bunker';
  } else if (map.id === 'icebreaker') {
    const deck = nums[0],
      centers = {
        0: 748,
        1: 677,
        2: 606,
        3: 535,
        4: 465,
        5: 394,
        7: 252,
        9: 111,
        12: 889,
        13: 960
      };
    level = {
      0: 'storage-security',
      1: 'infirmary',
      2: 'helipad',
      3: 'gym-canteen',
      4: 'accommodation-lower',
      5: 'accommodation-mid',
      7: 'officers-deck',
      9: 'bridge',
      12: 'engine-room',
      13: 'control-room'
    }[deck];
    if (!level) throw Error('Unknown Icebreaker deck ' + deck);
    // The source montage repeats a common ship silhouette. Each deck gets its own origin.
    pos = [550 + (x - centers[deck]) * 5.5, (y - 120) * 1.88 + 115];
    region = 'ship-' + level;
    label = d.floors.find(f => f.id === level).name;
  }
  pos ||= main(x, y);
  if (!pos.every(Number.isFinite) || pos.some(v => v < 0 || v > 1000))
    throw Error('Invalid registration ' + map.id + '/' + p.id + ': ' + pos);
  if (label === 'Ground / Main') label = floorNames[level] || label;
  return {
    id: p.id,
    x: +(pos[0] / 1000).toFixed(6),
    y: +(pos[1] / 1000).toFixed(6),
    floor: level,
    floorLabel: label,
    region,
    alignment: 'approximate'
  };
}
const doc = {
  schemaVersion: 1,
  coordinateSystem: 'normalized-tactical-artwork',
  sourceCommit: source.sourceCommit,
  notice:
    'Community image positions manually aligned to the tactical artwork. Alignment is approximate; use location photos for the exact spot.',
  anchors,
  maps: source.maps.map(m => ({ id: m.id, points: m.points.map(p => placement(m, p)) }))
};
fs.writeFileSync(
  path.join(__dirname, '../../app/data/battlepass-placement.json'),
  JSON.stringify(doc)
);
console.log(
  'Registered ' +
    doc.maps.flatMap(m => m.points).length +
    ' community spawns onto tactical artwork.'
);
module.exports = { affine, placement };
