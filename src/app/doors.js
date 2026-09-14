/*
 * doors, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { markerScale, point } from './geometry.js';
import { keyImage, keyName, questsNeedingKey } from './keys.js';
import { $, el, svg, toast, uiIcon } from './dom.js';

import { poiById, saveLayers } from './map-layers.js';
import { applyFloor, floorFor, floorName } from './floors.js';
import { setView } from './view.js';
import {
  allPois,
  assignView,
  currentMapId,
  floor,
  keyCatalog,
  labKeycards,
  mapDefinition
} from './state.js';
import { mapName } from './quest-state.js';

export function labDoorEntries() {
  if (currentMapId !== 'the-lab') return [];
  const cards = new Map(labKeycards.map(card => [card.id, card]));
  return allPois
    .filter(p => p.kind === 'locked-door')
    .flatMap(p => {
      const keyId = (p.keyIds || []).find(id => cards.has(id));
      return keyId ? [{ door: p, card: cards.get(keyId) }] : [];
    });
}

export function showKeycardDoor(entry) {
  const { door, card } = entry,
    pop = $('map-popup');
  pop.replaceChildren();
  const close = el('button', 'icon-only popup-close');
  close.append(uiIcon('close'));
  close.setAttribute('aria-label', 'Close keycard door');
  close.onclick = () => (pop.hidden = true);
  const cardLine = el('div', 'keycard-popup-card'),
    icon = el('img', 'keycard-item-icon'),
    copy = el('span');
  icon.src = 'assets' + card.iconPath;
  icon.alt = card.name;
  copy.append(el('strong', '', card.label), el('small', '', card.name));
  cardLine.append(icon, copy);
  pop.append(
    close,
    el('span', 'eyebrow', 'LABS KEYCARD DOOR'),
    el('strong', '', card.room),
    cardLine,
    el('small', '', floorName(floorFor(door.position)) + ' · This card opens the marked door.')
  );
  pop.hidden = false;
}
// Locked doors. Every bundled POI file carries them with the ids of the keys
// that open them, and only Labs ever drew them. Key names come from
// data/keys.json, a 16 KB extract, so the map never has to parse the 2.6 MB
// price catalog to print "Dorm room 206 key".
// The key as the game draws it. Falls back to the outline glyph for keys with
// no bundled image and for grouped labels like "A key or B key".

export function doorEntries() {
  const labCards = new Set(labKeycards.map(card => card.id));
  return allPois.filter(poi => {
    if (poi.kind !== 'locked-door') return false;
    // Labs keycard doors have their own layer with the card colours; drawing them
    // twice would just stack two markers on the same door.
    return !(currentMapId === 'the-lab' && (poi.keyIds || []).some(id => labCards.has(id)));
  });
}

export function showDoor(door) {
  const pop = $('map-popup');
  pop.replaceChildren();
  const close = el('button', 'icon-only popup-close');
  close.append(uiIcon('close'));
  close.setAttribute('aria-label', 'Close door');
  close.onclick = () => (pop.hidden = true);
  const ids = door.keyIds || [];
  pop.append(
    close,
    el('span', 'eyebrow', 'LOCKED DOOR'),
    (() => {
      const line = el('div', 'door-key-line');
      for (const id of ids) line.append(keyImage(id));
      line.append(el('strong', '', ids.map(keyName).join(' or ')));
      return line;
    })()
  );
  if (ids.length > 1) pop.append(el('p', 'door-note', 'Any one of these keys opens it.'));
  const wanted = [...new Set(ids.flatMap(questsNeedingKey))];
  if (wanted.length)
    pop.append(
      el(
        'p',
        'door-note',
        'Wanted by: ' +
          wanted.slice(0, 4).join(', ') +
          (wanted.length > 4 ? ' and ' + (wanted.length - 4) + ' more' : '')
      )
    );
  pop.append(
    el(
      'small',
      'door-note',
      floorName(floorFor(door.position)) + ' · from the bundled tarkov.dev map data'
    )
  );
  pop.hidden = false;
}
// Offers the door only when this map has one for that key, so the button never
// promises something the map cannot show.

// Offers the door only when this map has one for that key, so the button never
// promises something the map cannot show.
export function keyDoorButton(name) {
  const doors = doorsForKeyName(name);
  if (!doors.length) return null;
  const button = el('button', 'key-door-button');
  button.append(uiIcon('crosshair'));
  button.title =
    doors.length + ' door' + (doors.length === 1 ? '' : 's') + ' on ' + mapName(currentMapId);
  button.setAttribute('aria-label', 'Show the door for ' + name + ' on the map');
  button.onclick = event => {
    event.stopPropagation();
    showDoorsForKey(name);
  };
  return button;
}

export function renderDoors() {
  const layer = $('door-markers');
  if (!layer) return;
  layer.replaceChildren();
  if (!mapDefinition || !$('layer-doors')?.checked) return;
  const scale = markerScale();
  for (const door of doorEntries()) {
    if (floorFor(door.position) !== floor) continue;
    const pt = point(door.position),
      label = (door.keyIds || []).map(keyName).join(' or '),
      g = svg('g', {
        transform: `translate(${pt.x} ${pt.y}) scale(${scale})`,
        class: 'map-marker door-map-marker',
        tabindex: '0',
        role: 'button',
        'aria-label': 'Locked door · ' + label
      });
    g.append(
      svg('circle', {
        r: 11,
        fill: '#141a1c',
        'fill-opacity': '.9',
        stroke: '#c6b28a',
        'stroke-width': 1.1
      })
    );
    // The marker wears the key's own game image when one is bundled.
    const doorIcon = keyCatalog[(door.keyIds || [])[0]]?.icon;
    if (doorIcon) {
      g.append(
        svg('image', {
          href: doorIcon,
          x: -8,
          y: -8,
          width: 16,
          height: 16,
          preserveAspectRatio: 'xMidYMid meet'
        })
      );
    } else {
      const glyph = svg('use', {
        href: 'assets/icons.svg#keycard',
        x: -7,
        y: -5,
        width: 14,
        height: 10
      });
      glyph.setAttribute('class', 'door-glyph');
      g.append(glyph);
    }
    g.onclick = event => {
      event.stopPropagation();
      showDoor(door);
    };
    g.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showDoor(door);
      }
    };
    layer.append(g);
  }
}
// Switches. The POIs carry what each one operates, and the chains are the part
// worth showing: D-2 Power Switch unlocks D-2 Door Switch, which unlocks the
// D-2 extract. Targets are resolved by id against the same map's POIs.

// Switches. The POIs carry what each one operates, and the chains are the part
// worth showing: D-2 Power Switch unlocks D-2 Door Switch, which unlocks the
// D-2 extract. Targets are resolved by id against the same map's POIs.
export function switchEntries() {
  return allPois.filter(poi => poi.kind === 'switch');
}

export function switchEffects(control) {
  const verbs = { Unlock: 'Unlocks', Lock: 'Locks', Open: 'Opens', Close: 'Closes' };
  return (control.activates || []).map(step => {
    const target = poiById(step.targetId),
      verb = verbs[step.operation] || step.operation;
    if (!target) return verb + ' another ' + (step.targetKind || 'object') + ' on this map';
    const next = (target.activates || [])
      .map(onward => {
        const beyond = poiById(onward.targetId);
        return beyond
          ? (verbs[onward.operation] || onward.operation).toLowerCase() + ' ' + beyond.name
          : null;
      })
      .filter(Boolean);
    return (
      verb +
      ' ' +
      target.name +
      (target.kind === 'extract' ? ' (extract)' : '') +
      (next.length ? ', which ' + next.join(' and ') : '')
    );
  });
}

export function showSwitch(control) {
  const pop = $('map-popup');
  pop.replaceChildren();
  const close = el('button', 'icon-only popup-close');
  close.append(uiIcon('close'));
  close.setAttribute('aria-label', 'Close switch');
  close.onclick = () => (pop.hidden = true);
  pop.append(close, el('span', 'eyebrow', 'SWITCH'), el('strong', '', control.name));
  const effects = switchEffects(control);
  for (const effect of effects) pop.append(el('p', 'switch-effect', effect));
  if (!effects.length)
    pop.append(el('p', 'door-note', 'The map data does not record what this one operates.'));
  pop.append(
    el(
      'small',
      'door-note',
      floorName(floorFor(control.position)) + ' · from the bundled tarkov.dev map data'
    )
  );
  pop.hidden = false;
}
/* The BTR stops, which until now existed only as a landmark caption and so
 * only appeared if you had Landmarks switched on.
 *
 * The bundled POIs carry fourteen of them - six on Streets, eight on Woods -
 * as a name and a position each, and nothing else. **There is no route in
 * the data.** The ids run btr-0 upward, which looks like an order, but
 * joining them in that order gives a loop only 21% shorter than a random
 * one on Streets and 16% on Woods; a real driving order would be far better
 * than that. And the vehicle follows roads, which are not in the file at
 * all, so a straight line between two stops would cut through buildings.
 *
 * So: the stops are drawn, the route is not. Inventing the road it takes is
 * exactly the kind of confident wrong line this project does not draw.
 */
/* In the order upstream lists them, which is a route the vehicle actually
 * drives.
 *
 * This was got backwards once and it is worth the space. Each stop carries a
 * localisation key - Trading/Dialog/PlayerTaxi/Woods/p5/Name - and that `p5`
 * is not the array position, so the first reading here was that the array
 * order was meaningless and the p-numbering was the sequence. The argument
 * for it was that a straight-line tour in p-order is longer than the optimum,
 * and a road-following vehicle has no reason to look efficient in straight
 * lines - which is true, and answered a question nobody had asked.
 *
 * tarkovbtr.com publishes routes observed in raids, and they settle it:
 *
 *   Woods R5 WEST    Checkpoint, Sawmill, Scav Bunker, Sunken Village,
 *                    Train Depot, Old Sawmill, Junction, Emercom Base
 *   upstream array   p5 Checkpoint, p4 Sawmill, p1 Scav Bunker,
 *                    p2 Sunken Village, p7 Old Sawmill, p8 Train Depot,
 *                    p3 Junction, p6 Emercom Base
 *
 *   Streets R3 CINEMA  Rodina Cinema, Tram, Pinewood Hotel, Old Scav
 *                      Checkpoint, Collapsed Crane, City Center
 *   upstream array     p1, p2, p6, p5, p4, p3 - the same six, same order
 *
 * So the array order is a route: an exact match on Streets and one adjacent
 * swap on Woods. `stop` stays on the record because it is the game's own
 * label for a stop, but it is an id, not a sequence, and nothing sorts by it.
 *
 * **There is more than one route.** That source has five on Woods, three on
 * Streets and three on Lighthouse, chosen by where the vehicle spawned, and
 * they visit five to eight of the stops. One line cannot show that, so the
 * popup says which one this is rather than implying it is the only one.
 */

export function renderSwitches() {
  const layer = $('switch-markers');
  if (!layer) return;
  layer.replaceChildren();
  if (!mapDefinition || !$('layer-switches')?.checked) return;
  const scale = markerScale();
  for (const control of switchEntries()) {
    if (floorFor(control.position) !== floor) continue;
    const pt = point(control.position),
      g = svg('g', {
        transform: `translate(${pt.x} ${pt.y}) scale(${scale})`,
        class: 'map-marker switch-map-marker',
        tabindex: '0',
        role: 'button',
        'aria-label': 'Switch · ' + control.name
      });
    g.append(
      svg('circle', {
        r: 11,
        fill: '#141a1c',
        'fill-opacity': '.9',
        stroke: '#91b7d0',
        'stroke-width': 1.1
      })
    );
    g.append(svg('rect', { x: -3.5, y: -6, width: 7, height: 12, rx: 2.4, class: 'switch-glyph' }));
    g.append(svg('circle', { cx: 0, cy: -2.6, r: 1.7, class: 'switch-glyph-dot' }));
    g.onclick = event => {
      event.stopPropagation();
      showSwitch(control);
    };
    g.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showSwitch(control);
      }
    };
    layer.append(g);
  }
}

export function doorsForKeyName(name) {
  const wanted = Object.entries(keyCatalog)
    .filter(([, key]) => name.toLowerCase().includes(key.name.toLowerCase()))
    .map(([id]) => id);
  if (!wanted.length) return [];
  return doorEntries().filter(door => (door.keyIds || []).some(id => wanted.includes(id)));
}

export function showDoorsForKey(name) {
  const doors = doorsForKeyName(name);
  if (!doors.length) {
    toast('No door for ' + name + ' is mapped on ' + mapName(currentMapId) + '.');
    return;
  }
  $('layer-doors').checked = true;
  saveLayers();
  applyFloor(floorFor(doors[0].position));
  const points = doors.map(door => point(door.position)),
    minX = Math.min(...points.map(p => p.x)),
    maxX = Math.max(...points.map(p => p.x)),
    minY = Math.min(...points.map(p => p.y)),
    maxY = Math.max(...points.map(p => p.y)),
    w = Math.max(200, (maxX - minX) * 1.6),
    h = Math.max(130, (maxY - minY) * 1.6);
  assignView({ x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h });
  setView();
  if (doors.length === 1) showDoor(doors[0]);
  toast(doors.length + ' door' + (doors.length === 1 ? '' : 's') + ' for ' + name + '.');
}

export function renderKeycardDoors() {
  const markerLayer = $('keycard-doors'),
    labelLayer = $('keycard-labels');
  if (!markerLayer || !labelLayer) return;
  markerLayer.replaceChildren();
  labelLayer.replaceChildren();
  if (currentMapId !== 'the-lab' || !$('layer-lab-keycards')?.checked) return;
  const entries = labDoorEntries(),
    showNames = $('layer-lab-keycard-labels')?.checked,
    scale = markerScale(),
    totals = new Map();
  for (const entry of entries) totals.set(entry.card.id, (totals.get(entry.card.id) || 0) + 1);
  const seen = new Map();
  for (const entry of entries) {
    const { door, card } = entry,
      doorFloor = floorFor(door.position);
    if (doorFloor !== floor) continue;
    const pt = point(door.position),
      g = svg('g', {
        transform: `translate(${pt.x} ${pt.y}) scale(${scale})`,
        class: 'map-marker keycard-map-marker',
        tabindex: '0',
        role: 'button',
        'aria-label': card.name + ' opens ' + card.room
      });
    g.append(
      svg('circle', {
        r: 18,
        fill: '#101719',
        'fill-opacity': '.88',
        stroke: card.accent,
        'stroke-width': 1.2
      })
    );
    g.append(
      svg('image', {
        x: -15,
        y: -10,
        width: 30,
        height: 20,
        href: 'assets' + card.iconPath,
        preserveAspectRatio: 'xMidYMid meet'
      })
    );
    const order = (seen.get(card.id) || 0) + 1;
    seen.set(card.id, order);
    if (totals.get(card.id) > 1) {
      const badge = svg('g', { transform: 'translate(12 -12)' });
      badge.append(
        svg('circle', { r: 6, fill: '#0c1214', stroke: card.accent, 'stroke-width': 1 })
      );
      const number = svg('text', {
        y: 2.5,
        fill: '#f3f6f4',
        'font-size': 7,
        'font-weight': 800,
        'text-anchor': 'middle'
      });
      number.textContent = order;
      badge.append(number);
      g.append(badge);
    }
    const title = svg('title');
    title.textContent = card.name + ' — ' + card.room;
    g.append(title);
    g.onclick = e => {
      e.stopPropagation();
      showKeycardDoor(entry);
    };
    g.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showKeycardDoor(entry);
      }
    };
    markerLayer.append(g);
    if (showNames) {
      const label = svg('text', {
        x: pt.x,
        y: pt.y + 25 * scale,
        'text-anchor': 'middle',
        fill: card.accent,
        stroke: '#101719',
        'stroke-width': 3 * scale,
        'paint-order': 'stroke',
        'font-size': 8 * scale,
        'font-family': 'Consolas,monospace',
        'font-weight': 700,
        'letter-spacing': 0.25 * scale
      });
      label.textContent = card.label + (totals.get(card.id) > 1 ? ' ' + order : '');
      labelLayer.append(label);
    }
  }
}
