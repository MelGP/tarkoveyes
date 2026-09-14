/*
 * btr, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { allPois, floor, mapDefinition } from './state.js';

import { $, el, svg, uiIcon } from './dom.js';
import { markerScale, point } from './geometry.js';
import { floorFor, floorName } from './floors.js';

export function btrStops() {
  return allPois.filter(p => p.kind === 'btr');
}

export function renderBtr() {
  const layer = $('btr-markers');
  if (!layer) return;
  layer.replaceChildren();
  if (!mapDefinition || !$('layer-btr')?.checked) return;
  const scale = markerScale();
  const stops = btrStops();
  /* The line first, so every marker sits on top of it.

     What this is, exactly: the stops joined in the order the game numbers
     them, in straight lines. It is **not** the road the BTR drives - no
     source used here publishes that, and the map artwork has a Roads layer
     but nothing saying which of them the vehicle uses. So it is a circuit
     diagram, and the popup and the label both say so.

     The order is upstream's own array order, which raid-observed routes
     published on tarkovbtr.com match - see btrStops() for the comparison. An
     earlier version of this sorted by the p-number instead and drew a shape
     no route takes. */
  if ($('layer-btr-route')?.checked && stops.length > 1) {
    const ring = stops.filter(s => floorFor(s.position) === floor).map(s => point(s.position));
    if (ring.length > 1) {
      layer.append(
        svg('path', {
          class: 'btr-route',
          d: 'M' + ring.map(p => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join('L') + 'Z',
          'stroke-width': 2.2 * scale,
          'stroke-dasharray': 7 * scale + ' ' + 5 * scale
        })
      );
    }
  }
  for (const stop of stops) {
    if (floorFor(stop.position) !== floor) continue;
    const pt = point(stop.position),
      g = svg('g', {
        transform: `translate(${pt.x} ${pt.y}) scale(${scale})`,
        class: 'map-marker btr-map-marker',
        tabindex: '0',
        role: 'button',
        'aria-label': 'BTR stop · ' + stop.name
      });
    g.append(
      svg('circle', {
        r: 11,
        fill: '#141a1c',
        'fill-opacity': '.9',
        stroke: '#9ab27a',
        'stroke-width': 1.2
      })
    );
    /* The vehicle in profile, facing right: a long sloped nose, a low hull,
       the turret set forward of centre and four road wheels for the eight it
       has. Filled rather than outlined - at seventeen pixels a silhouette
       reads and a two-stroke outline turns to mush - and drawn for this
       project rather than lifted from the game, which is the line kept with
       interface art everywhere else here.

       It was a rounded box on two wheels first, and the user said so: that
       is a bus. What makes it a BTR is the wedge nose and the gun. */
    const body = svg('g', { class: 'btr-glyph', transform: 'scale(.86)' });
    body.append(
      svg('path', {
        d: 'M-8.4 1.4 L-8.4 -2.4 L-6 -3.9 L2.6 -3.9 L8.6 -0.2 L8.6 1.4 Z'
      })
    );
    body.append(svg('path', { d: 'M-1.6 -3.9 L-0.8 -6.2 L2.2 -6.2 L3 -3.9 Z' }));
    body.append(svg('rect', { x: 2.8, y: -5.8, width: 6.2, height: 1.1, rx: 0.5 }));
    for (const cx of [-6, -2.4, 1.6, 5.4]) body.append(svg('circle', { cx, cy: 1.9, r: 1.9 }));
    g.append(body);
    /* The number only appears with the line, because on its own it is an
       identifier nobody asked for; alongside the circuit it is what makes
       the circuit readable. */
    /* Numbered along the route rather than by `stop`: the badge exists to
       make the line readable, and for that the useful number is how far
       along you are, not which id the game gave the place. */
    const order = stops.indexOf(stop) + 1;
    if ($('layer-btr-route')?.checked && order) {
      g.append(
        svg('circle', {
          cx: 8.4,
          cy: -8.4,
          r: 5.4,
          fill: '#141a1c',
          stroke: '#9ab27a',
          'stroke-width': 1.1
        })
      );
      const n = svg('text', {
        x: 8.4,
        y: -6.4,
        fill: '#c4dba4',
        'font-size': 7,
        'font-weight': 700,
        'text-anchor': 'middle'
      });
      n.textContent = order;
      g.append(n);
    }
    const title = svg('title');
    title.textContent = 'BTR stop · ' + stop.name;
    g.append(title);
    const open = () => showBtrStop(stop);
    g.onclick = event => {
      event.stopPropagation();
      open();
    };
    g.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    };
    layer.append(g);
  }
}

export function showBtrStop(stop) {
  const pop = $('map-popup');
  pop.replaceChildren();
  const close = el('button', 'icon-only popup-close');
  close.append(uiIcon('close'));
  close.setAttribute('aria-label', 'Close BTR stop');
  close.onclick = () => (pop.hidden = true);
  pop.append(
    close,
    el('span', 'eyebrow', 'BTR STOP'),
    el('strong', '', stop.name),
    el(
      'small',
      '',
      'Stop ' +
        (btrStops().indexOf(stop) + 1) +
        ' of ' +
        btrStops().length +
        ' · ' +
        floorName(floorFor(stop.position))
    ),
    el(
      'small',
      /* Said out loud rather than implied by an absent line: the data has
         the stops and not the route, and a person reading a map deserves to
         know which of the two they are looking at. */
      '',
      'The line joins the stops in the order the game lists them - one of several routes the BTR runs, chosen by where it spawns - in straight lines. The roads it takes between them are in no published data.'
    )
  );
  pop.hidden = false;
}
