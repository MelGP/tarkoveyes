/*
 * player, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { applyFloor, floorFor } from './floors.js';
import { centeredView, markerScale, point } from './geometry.js';
import { mapName, profile } from './quest-state.js';
import { renderLogDiagnostics } from './activity.js';
import { $, svg, toast } from './dom.js';

import { setView } from './view.js';
import { whenBriefly } from './app.js';
import {
  assignConfirmedFix,
  assignCurrentFix,
  assignLastFixTime,
  assignView,
  confirmedFix,
  currentFix,
  currentMapId,
  data,
  lastFixTime,
  mapDefinition,
  observer
} from './state.js';

export function renderPlayer() {
  $('player').replaceChildren();
  if (!currentFix) return;
  const pt = point(currentFix),
    s = markerScale(),
    stale = Date.now() - currentFix.observedAt > 60000;
  const g = svg('g', {
    transform: `translate(${pt.x} ${pt.y}) scale(${s})`,
    opacity: stale ? '.55' : '1'
  });
  g.append(
    svg('circle', {
      r: 20,
      fill: '#f3e9c9',
      'fill-opacity': '.1',
      stroke: '#ede7ce',
      'stroke-width': 1
    })
  );
  if (currentFix.heading !== null)
    g.append(
      svg('path', {
        d: 'M 0 -24 L -6 -12 L 6 -12 Z',
        fill: '#fff1bd',
        transform: 'rotate(' + (currentFix.heading - (mapDefinition.coordinateRotation || 0)) + ')'
      })
    );
  g.append(svg('circle', { r: 6, fill: '#fff1bd', stroke: '#303326', 'stroke-width': 2 }));
  $('player').append(g);
}

export function centerPlayer() {
  if (!currentFix) {
    toast('Take a new in-game screenshot after connecting.');
    return;
  }
  assignView(centeredView(point(currentFix)));
  applyFloor(floorFor(currentFix));
  setView();
}

export function updatePosition() {
  const p = observer.position;
  renderLogDiagnostics();
  const knownMap = p?.map === currentMapId;
  const manuallyConfirmed = p && confirmedFix === p.observedAt;
  assignCurrentFix(p && (knownMap || manuallyConfirmed) ? p : null);
  if (observer.error) {
    $('connection-title').textContent = 'Check your connection';
    $('connection-sub').textContent = observer.error;
  } else if (observer.connected) {
    $('connection-title').textContent = 'Listening for screenshots';
    $('connection-sub').textContent =
      observer.screenshotCount +
      ' files · ' +
      (observer.logsConnected
        ? profile().questSync?.lastScanAt
          ? 'logs read ' + whenBriefly(profile().questSync.lastScanAt)
          : 'raid logs connected'
        : 'map confirmation needed');
  } else {
    $('connection-title').textContent = 'Ready when you are';
    $('connection-sub').textContent = 'Connect your screenshots folder';
  }
  $('connection-dot').style.background =
    observer.connected && !observer.error ? '#82c7a7' : '#e5bc74';
  if (p && !knownMap && !manuallyConfirmed) {
    $('position-value').textContent = p.map
      ? 'Screenshot map: ' + mapName(p.map) + ' · select that location'
      : 'Map unconfirmed — click to confirm ' + mapName(currentMapId);
    $('position-age').textContent = '';
    $('position-value').style.pointerEvents = p.map ? 'none' : 'auto';
    $('position-value').style.cursor = p.map ? 'default' : 'pointer';
    $('position-value').onclick = () => {
      if (
        !p.map &&
        window.confirm(
          'Was this new screenshot taken on ' +
            mapName(currentMapId) +
            '? Only confirm if you know the map matches.'
        )
      ) {
        assignConfirmedFix(p.observedAt);
        updatePosition();
      }
    };
  } else if (currentFix) {
    $('position-value').textContent =
      'X ' + p.x.toFixed(1) + ' · Y ' + p.y.toFixed(1) + ' · Z ' + p.z.toFixed(1);
    $('position-value').onclick = null;
    if (p.observedAt !== lastFixTime) {
      assignLastFixTime(p.observedAt);
      if (data.settings.autoFollow) centerPlayer();
    }
  } else {
    $('position-value').textContent =
      observer.raid === 'ended'
        ? 'Raid ended · waiting for a new screenshot'
        : 'Waiting for an in-game screenshot';
    $('position-age').textContent = '';
    $('position-value').onclick = null;
  }
  updateAge();
  renderPlayer();
}

export function updateAge() {
  if (!currentFix) return;
  const seconds = Math.max(0, Math.floor((Date.now() - currentFix.observedAt) / 1000));
  $('position-age').textContent =
    seconds < 60 ? seconds + 's ago' : Math.floor(seconds / 60) + 'm ago';
  $('position-label').textContent =
    seconds > 60 ? 'LAST RECORDED POSITION · STALE' : 'LAST RECORDED POSITION';
  renderPlayer();
}
