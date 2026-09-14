/*
 * markers, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { markerScale, point } from './geometry.js';
import { visibleRaidQuests } from './my-raid.js';
import {
  hideDoneObjectives,
  isDone,
  objectivePoints,
  questMarkerMeta,
  status
} from './quest-state.js';
import { $, el, svg, toast, uiIcon } from './dom.js';

import {
  doneColor,
  doneRank,
  markerRanks,
  objectiveVerb,
  questPinPath,
  verbLabels,
  wayoutRank
} from './vocabulary.js';
import { selectQuest } from './app.js';
import { floorFor } from './floors.js';
import { focusQuest } from './view.js';
import { floor, myRaidOpen, pois, quests, selected } from './state.js';

export function verbGlyph(verb, color) {
  const line = (x1, y1, x2, y2) =>
    svg('line', {
      x1,
      y1,
      x2,
      y2,
      stroke: color,
      'stroke-width': 1.7,
      'stroke-linecap': 'round'
    });
  const stroke = (tag, attrs) =>
    svg(tag, {
      ...attrs,
      fill: 'none',
      stroke: color,
      'stroke-width': 1.7,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    });
  switch (verb) {
    case 'find':
      // a magnifier: there is an item here and you have to look for it
      return [stroke('circle', { cx: -1.1, cy: -1.1, r: 3.9 }), line(1.8, 1.8, 4.7, 4.7)];
    case 'visit':
      // an eye: go and look, nothing to carry
      return [
        stroke('path', { d: 'M-5.6 0 Q0 -4.4 5.6 0 Q0 4.4 -5.6 0 Z' }),
        svg('circle', { cx: 0, cy: 0, r: 1.7, fill: color })
      ];
    case 'mark':
      // a beacon: a marker you had to bring, planted, transmitting
      return [
        svg('circle', { cx: 0, cy: 3.1, r: 1.8, fill: color }),
        stroke('path', { d: 'M-3.1 0.4 A4 4 0 0 1 3.1 0.4' }),
        stroke('path', { d: 'M-5.5 -2.4 A7 7 0 0 1 5.5 -2.4' })
      ];
    case 'plant':
      // down onto a shelf: you are leaving something behind
      return [
        line(0, -5.2, 0, 1.4),
        stroke('polyline', { points: '-2.7,-1.4 0,1.6 2.7,-1.4' }),
        line(-4.4, 4.3, 4.4, 4.3)
      ];
    case 'shoot':
      // a crosshair, the one glyph nobody has to be taught
      return [
        stroke('circle', { cx: 0, cy: 0, r: 3.4 }),
        line(0, -6, 0, -4.4),
        line(0, 4.4, 0, 6),
        line(-6, 0, -4.4, 0),
        line(4.4, 0, 6, 0)
      ];
    case 'signal':
      // up, and a spark at the top: a flare is the one thing on this map you
      // send away from yourself rather than go to
      /* Eight rays off an empty centre. This was an up arrow with sparks over
         it first, and the two merged into a smudge at the size a marker really
         draws - the user asked what the icon was, which is the answer. A
         starburst has nothing to merge with: it degrades into a blob that is
         still recognisably a blob of rays. The centre stays empty so it cannot
         be read as the crosshair, which is a ring with a dot's worth of solid
         in the middle. */
      return [
        line(0, -6.2, 0, -2.2),
        line(0, 2.2, 0, 6.2),
        line(-6.2, 0, -2.2, 0),
        line(6.2, 0, 2.2, 0),
        line(-4.4, -4.4, -1.6, -1.6),
        line(4.4, 4.4, 1.6, 1.6),
        line(-4.4, 4.4, -1.6, 1.6),
        line(4.4, -4.4, 1.6, -1.6)
      ];
    case 'extract':
      // the same arrow the extract layer draws, because it is the same idea
      // and a second vocabulary for one thing is what this change is undoing
      return [
        /* Pulled down-left off the number badge, which sits on the same
           shoulder this arrow points at. */
        line(-4.4, 4.4, 2.6, -2.6),
        stroke('polyline', { points: '-0.4,-2.6 2.6,-2.6 2.6,0.4' })
      ];
    case 'done':
      // a tick: what you were supposed to do here stops mattering once you
      // have done it, so the verb gives way rather than being decorated
      return [stroke('polyline', { points: '-5,0.2 -1.6,3.8 5.2,-3.4' })];
    default:
      return [svg('circle', { cx: 0, cy: 0, r: 2.6, fill: color })];
  }
}

export function questPin(g, color, candidate, number, stacked, verb) {
  /* The ground shadow is what stops a pin floating: without it the tip reads
     as the bottom of a balloon rather than as the spot itself. */
  g.append(svg('ellipse', { cx: 0, cy: 1.2, rx: 5, ry: 1.9, fill: '#000', opacity: '.42' }));
  /* A stack of pins, not one pin with a bigger number. Two objectives on one
     spot and quest number two would otherwise both be a pin reading "2" - the
     same collision this change exists to end, moved one layer in. Fanning two
     more silhouettes behind it makes the silhouette itself say "several",
     which survives being 14 pixels tall in a way a glyph would not. */
  if (stacked)
    for (const shift of ['translate(-8 -2.8) scale(.78)', 'translate(8 -2.8) scale(.78)'])
      g.append(
        svg('path', {
          d: questPinPath,
          transform: shift,
          fill: '#0e1719',
          'fill-opacity': '.95',
          stroke: color,
          'stroke-width': 2.6,
          'stroke-opacity': '.62',
          'stroke-linejoin': 'round'
        })
      );
  g.append(
    svg('path', {
      d: questPinPath,
      fill: '#0e1719',
      'fill-opacity': '.96',
      stroke: color,
      'stroke-width': 2,
      'stroke-linejoin': 'round',
      /* A possible location is one of several the quest might use, so its
         outline is broken - the same language the old marker used. */
      'stroke-dasharray': candidate ? '3.5 3' : ''
    })
  );
  g.append(svg('circle', { cx: 0, cy: -20, r: 7.6, fill: color, 'fill-opacity': '.15' }));
  g.append(svg('circle', { cx: 0, cy: 0, r: 1.8, fill: color }));
  if (stacked) {
    /* Several objectives on one spot can be several different verbs, so the
       head shows how many rather than picking one of them to stand for all. */
    const t = svg('text', {
      x: 0,
      y: -16.4,
      fill: color,
      'font-size': String(number).length > 1 ? 9 : 11,
      'font-weight': 700,
      'text-anchor': 'middle'
    });
    t.textContent = number;
    g.append(t);
    return g;
  }
  const head = svg('g', { transform: 'translate(0 -20)' });
  for (const shape of verbGlyph(verb, color)) head.append(shape);
  g.append(head);
  /* The quest number is a badge on the shoulder rather than the head, because
     a numeral in the middle of a marker is exactly what every count on this
     map looks like. On a badge it reads as an identity, which is what it is:
     the figure beside the matching card in My Raid. A quest that is not in
     that list has no index, and then it has no badge either. */
  if (number == null) return g;
  g.append(
    svg('circle', {
      cx: 9.4,
      cy: -27.6,
      r: 6.4,
      fill: '#0e1719',
      'fill-opacity': '.97',
      stroke: color,
      'stroke-width': 1.6
    })
  );
  const badge = svg('text', {
    x: 9.4,
    y: -25.2,
    fill: color,
    'font-size': String(number).length > 1 ? 6.4 : 7.8,
    'font-weight': 700,
    'text-anchor': 'middle'
  });
  badge.textContent = number;
  g.append(badge);
  return g;
}

export function makeMarker(
  p,
  label,
  color,
  shape = 'extract',
  candidate = false,
  number = null,
  verb = 'other'
) {
  const pt = point(p),
    s = markerScale();
  const g = svg('g', {
    transform: `translate(${pt.x} ${pt.y}) scale(${s})`,
    class: 'map-marker',
    'data-kind': shape,
    tabindex: '0',
    role: 'button',
    'aria-label': label
  });
  if (shape === 'cluster') questPin(g, color, false, number, true, null);
  else if (shape === 'quest') questPin(g, color, candidate, number, false, verb);
  else {
    g.append(
      svg('rect', {
        x: -10,
        y: -10,
        width: 20,
        height: 20,
        rx: 5,
        fill: '#152322',
        stroke: color,
        'stroke-width': 1.3
      })
    );
    const t = svg('text', { x: 0, y: 4, fill: color, 'font-size': 13, 'text-anchor': 'middle' });
    t.textContent = shape === 'transit' ? '⇄' : '↗';
    g.append(t);
  }
  const title = svg('title');
  title.textContent = label;
  g.append(title);
  return g;
}

export function showPopup(p) {
  const pop = $('map-popup');
  pop.replaceChildren();
  const close = el('button', '', '×');
  close.setAttribute('aria-label', 'Close marker details');
  close.onclick = () => (pop.hidden = true);
  pop.append(
    close,
    el('span', 'eyebrow', p.kind === 'transit' ? 'TRANSIT POINT' : 'EXTRACTION POINT'),
    el('strong', '', p.name),
    el(
      'small',
      '',
      p.category.replace('extract-', '').toUpperCase() +
        ' · elevation ' +
        p.position.y.toFixed(1) +
        ' m'
    )
  );
  if (p.transferItem)
    pop.append(
      el(
        'small',
        '',
        'Payment requirement in dataset: ' + p.transferItem.count.toLocaleString() + ' units.'
      )
    );
  if (p.switchIds?.length)
    pop.append(el('small', '', 'Requires activation. Check the in-game conditions.'));
  pop.append(el('small', '', 'Known location — availability is determined in-game for each raid.'));
  pop.hidden = false;
}

export function showQuestCluster(entries) {
  const unique = [
      ...new Map(entries.map(entry => [entry.q.id + ':' + entry.p.objective.id, entry])).values()
    ],
    pop = $('map-popup');
  pop.replaceChildren();
  const close = el('button', 'icon-only popup-close');
  close.append(uiIcon('close'));
  close.setAttribute('aria-label', 'Close overlapping quests');
  close.onclick = () => (pop.hidden = true);
  pop.append(
    close,
    el('span', 'eyebrow', 'OVERLAPPING POINTS'),
    el('strong', '', unique.length + ' quest objectives here')
  );
  const list = el('div', 'cluster-list');
  for (const entry of unique) {
    const meta = questMarkerMeta(entry.q),
      button = el('button', 'cluster-choice'),
      number = el('span', 'cluster-number', String(meta.number || '•'));
    number.style.borderColor = meta.color;
    number.style.color = meta.color;
    const copy = el('span', 'cluster-copy');
    copy.append(el('strong', '', entry.q.name), el('small', '', entry.p.objective.description));
    button.append(number, copy);
    button.onclick = () => {
      pop.hidden = true;
      selectQuest(entry.q);
      focusQuest(entry.q, entry.p.objective.id);
    };
    list.append(button);
  }
  pop.append(list);
  pop.hidden = false;
}

export function renderMarkers() {
  $('markers').replaceChildren();
  for (const p of pois) {
    let visible =
      p.category === 'transit'
        ? $('layer-transit').checked
        : p.category === 'extract-shared'
          ? $('layer-extract').checked || $('layer-scav').checked
          : p.category === 'extract-scav'
            ? $('layer-scav').checked
            : p.category === 'extract-pmc'
              ? $('layer-extract').checked
              : false;
    if (!visible) continue;
    const g = makeMarker(
      p.position,
      p.name,
      p.category === 'transit' || p.category === 'extract-scav' ? '#8abdd0' : '#97d5af',
      p.category === 'transit' ? 'transit' : 'extract'
    );
    g.onclick = e => {
      e.stopPropagation();
      showPopup(p);
    };
    g.onkeydown = e => {
      if (e.key === 'Enter') showPopup(p);
    };
    $('markers').append(g);
  }
  const shown = selected
    ? [selected]
    : myRaidOpen
      ? visibleRaidQuests()
      : quests.filter(q => status(q) === 'active');
  const threshold = 18 * markerScale(),
    clusters = [];
  for (const q of shown)
    for (const p of objectivePoints(q)) {
      /* Dropped here rather than at drawing time so the cluster counts are
         about what is left to do, not about what used to be here. */
      if (hideDoneObjectives && isDone(p.objective)) continue;
      const projected = point(p),
        cluster = clusters.find(
          item =>
            Math.hypot(item.projected.x - projected.x, item.projected.y - projected.y) <= threshold
        );
      if (cluster) cluster.entries.push({ q, p });
      else clusters.push({ projected, entries: [{ q, p }] });
    }
  for (const cluster of clusters) {
    const unique = [
      ...new Map(
        cluster.entries.map(entry => [entry.q.id + ':' + entry.p.objective.id, entry])
      ).values()
    ];
    if (unique.length > 1) {
      const finished = unique.filter(entry => isDone(entry.p.objective)).length,
        allFinished = finished === unique.length,
        g = makeMarker(
          unique[0].p,
          unique.length +
            ' overlapping quest objectives' +
            (finished ? ' (' + finished + ' already done)' : ''),
          allFinished ? doneColor : '#f4c980',
          'cluster',
          false,
          unique.length
        ),
        floors = unique.map(entry => floorFor(entry.p));
      if (allFinished) g.dataset.done = 1;
      g.setAttribute(
        'opacity',
        allFinished ? (floors.includes(floor) ? '.4' : '.26') : floors.includes(floor) ? '1' : '.55'
      );
      g.onclick = e => {
        e.stopPropagation();
        showQuestCluster(unique);
      };
      g.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showQuestCluster(unique);
        }
      };
      $('markers').append(g);
      continue;
    }
    const { q, p } = cluster.entries[0],
      meta = questMarkerMeta(q),
      /* isDone used to be consulted only when the quest was NOT in My Raid -
         which is exactly when you are not working on it. For the quests you
         are actually on, a finished objective drew the identical pin, and the
         map went on pointing at places you had already been. */
      finished = isDone(p.objective),
      color = finished ? doneColor : meta.number ? meta.color : '#f4c980',
      verb = finished ? 'done' : objectiveVerb(p.objective),
      g = makeMarker(
        p,
        (meta.number ? 'Quest ' + meta.number + ': ' : '') +
          q.name +
          ' — ' +
          p.objective.description +
          /* The glyph is the whole point of the head, so anything that reads
             the label rather than the picture has to be told the same thing. */
          (verbLabels[verb] ? ' (' + verbLabels[verb].toLowerCase() + ')' : ''),
        color,
        'quest',
        p.candidate,
        meta.number,
        verb
      ),
      f = floorFor(p);
    /* Quiet, not gone. Hiding it by default would lose the fact that the
       point is there at all, and the checkbox is for people who want that. */
    if (finished) g.dataset.done = 1;
    g.setAttribute('opacity', finished ? (floor === f ? '.4' : '.26') : floor === f ? '1' : '.55');
    g.onclick = e => {
      e.stopPropagation();
      selectQuest(q);
      toast(
        p.objective.description + ' · ' + (f === 'Ground_Level' ? 'Ground' : f.replaceAll('_', ' '))
      );
    };
    g.onkeydown = e => {
      if (e.key === 'Enter') selectQuest(q);
    };
    $('markers').append(g);
  }
}

export function popupClose(label) {
  const close = el('button', 'icon-only popup-close');
  close.append(uiIcon('close'));
  close.setAttribute('aria-label', label);
  close.onclick = () => ($('map-popup').hidden = true);
  return close;
}

export let declutterFrame = 0,
  declutterAgain = 0;

export function scheduleDeclutter() {
  cancelAnimationFrame(declutterFrame);
  clearTimeout(declutterAgain);
  declutterFrame = requestAnimationFrame(declutterMarkers);
  // Redrawing a layer replaces its markers and takes their ranking with them,
  // and the loot layer redraws on a debounce of its own. Running once more once
  // everything has settled costs a millisecond and saves the map from coming
  // back crowded after a layer lands late.
  declutterAgain = setTimeout(declutterMarkers, 160);
}

export function declutterMarkers() {
  /* Clearing the class invalidates layout and reading a box forces it back,
     so doing both to one marker before moving to the next made every marker
     pay for a re-layout of the whole SVG - 4.76ms of a 4.8ms pass, by the
     sampling profiler. Every write first, then every read: one layout for the
     pass. Same values, same order, same ranking out. */
  const nodes = [];
  for (const [id, rank] of markerRanks) {
    const group = $(id);
    if (!group) continue;
    for (const node of group.children) nodes.push({ node, id, rank });
  }
  for (const item of nodes) item.node.classList.remove('crowded');
  const candidates = [];
  for (const { node, id, rank } of nodes) {
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const kind = node.dataset.kind;
    candidates.push({
      node,
      /* A finished objective is still drawn, so it still has a box, and a box
         that wins a spot pushes an outstanding objective aside - the opposite
         of the point. It ranks below the extracts it shares a layer with. */
      rank:
        id === 'markers'
          ? node.dataset.done
            ? doneRank
            : kind !== 'quest' && kind !== 'cluster'
              ? wayoutRank
              : rank
          : rank,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      reach: Math.max(box.width, box.height) / 2
    });
  }
  candidates.sort((a, b) => a.rank - b.rank);
  const kept = [];
  for (const candidate of candidates) {
    // The rule is simply that two markers may not overlap: quieten one as soon
    // as the centres are closer than the two radii together. Measured on
    // Customs with every layer on, that leaves 7 collisions where there were
    // 233, and still shows 112 of the 161 markers at full strength.
    const buried = kept.some(
      other =>
        Math.hypot(other.x - candidate.x, other.y - candidate.y) < other.reach + candidate.reach
    );
    if (buried) candidate.node.classList.add('crowded');
    else kept.push(candidate);
  }
}
