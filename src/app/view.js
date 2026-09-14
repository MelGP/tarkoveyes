/*
 * view, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { renderBosses } from './bosses.js';
import { renderCustomMarkers } from './custom-markers.js';
import { $, toast } from './dom.js';
import { renderDoors, renderKeycardDoors, renderSwitches } from './doors.js';
import { applyFloor, floorFor } from './floors.js';
import { centeredView, point } from './geometry.js';
import { renderLandmarks } from './landmarks.js';
import { scheduleLootRender } from './loot.js';
import { renderExtractLabels } from './map-layers.js';
import { renderMarkers, scheduleDeclutter } from './markers.js';
import { scheduleBriefAlign } from './quest-brief.js';
import { mapName, objectivePoints } from './quest-state.js';
import {
  H,
  W,
  assignDetailsCollapsed,
  assignMapFocus,
  assignView,
  currentMapId,
  detailsCollapsed,
  mapDefinition,
  mapFocus,
  view
} from './state.js';
import { renderBattlepass } from './app.js';
import { renderPlayer } from './player.js';

export function setDetailsCollapsed(collapsed) {
  assignDetailsCollapsed(!!collapsed);
  const main = document.querySelector('main');
  main.classList.toggle('details-collapsed', detailsCollapsed);
  $('toggle-details').classList.toggle('active', !detailsCollapsed);
  $('toggle-details').setAttribute('aria-expanded', String(!detailsCollapsed));
  $('toggle-details').title = detailsCollapsed ? 'Show quest details' : 'Hide quest details';
  scheduleBriefAlign();
  requestAnimationFrame(() => setView());
}

export function setMapFocus(active) {
  assignMapFocus(!!active);
  document.querySelector('main').classList.toggle('map-focus', mapFocus);
  scheduleBriefAlign();
  $('focus-map').classList.toggle('active', mapFocus);
  $('focus-map').setAttribute('aria-pressed', String(mapFocus));
  $('focus-map').querySelector('span').textContent = mapFocus ? 'Exit' : 'Focus';
  $('focus-map').title = mapFocus ? 'Exit focus map (F or Esc)' : 'Focus map (F)';
  requestAnimationFrame(() => setView());
}

export function focusMapPosition(position, label) {
  const projected = point(position),
    width = Math.max(220, Math.min(view.w, W * 0.42));
  assignView(centeredView(projected, width, (width * H) / W));
  applyFloor(floorFor(position));
  setView();
  $('focus-label').textContent = label;
  toast('Showing ' + label + '.');
}

/* Panning only slides the viewBox, and every marker layer is drawn in map
 * coordinates, so the SVG carries them along for nothing. Sizes come from
 * `view.w` and clustering cells from the same, neither of which a pan changes,
 * and the decluttering is decided from distances between markers, which a
 * translation leaves identical.
 *
 * The one layer that genuinely depends on where you are is the loot one,
 * because it culls to the viewport - and that already runs on a debounce.
 *
 * So a drag needs the viewBox and nothing else. `setView()` stays the full
 * rebuild for everything that is not a pan: zooming, switching floors,
 * toggling a layer, selecting a quest.
 */
export function panView() {
  $('map-svg').setAttribute('viewBox', [view.x, view.y, view.w, view.h].join(' '));
  scheduleLootRender();
}
/* Zooming does change what a rebuild would produce - marker sizes and the
 * clustering cells both come from `view.w` - so it cannot be skipped. It can
 * be deferred until you stop.
 *
 * Settling once per animation frame was already far better than once per wheel
 * event, but the rebuild is 24ms on a busy map and the frame is 16, so a
 * sustained zoom still dropped frames. Settling after the gesture instead
 * costs nothing per frame: the viewBox moves immediately and the SVG scales
 * the markers along with the map, then they resettle to their proper sizes and
 * clusters once the wheel goes quiet.
 *
 * The visible cost is that markers grow and shrink with the map while you are
 * zooming, which on a map reads as the map zooming rather than as a bug, and
 * clusters do not split until you stop.
 */

/* Zooming does change what a rebuild would produce - marker sizes and the
 * clustering cells both come from `view.w` - so it cannot be skipped. It can
 * be deferred until you stop.
 *
 * Settling once per animation frame was already far better than once per wheel
 * event, but the rebuild is 24ms on a busy map and the frame is 16, so a
 * sustained zoom still dropped frames. Settling after the gesture instead
 * costs nothing per frame: the viewBox moves immediately and the SVG scales
 * the markers along with the map, then they resettle to their proper sizes and
 * clusters once the wheel goes quiet.
 *
 * The visible cost is that markers grow and shrink with the map while you are
 * zooming, which on a map reads as the map zooming rather than as a bug, and
 * clusters do not split until you stop.
 */
export let zoomSettleTimer = 0;

export function zoomView() {
  panView();
  clearTimeout(zoomSettleTimer);
  zoomSettleTimer = setTimeout(setView, 90);
}

export function setView() {
  $('map-svg').setAttribute('viewBox', [view.x, view.y, view.w, view.h].join(' '));
  renderMarkers();
  renderKeycardDoors();
  renderDoors();
  renderSwitches();
  renderBosses();
  renderCustomMarkers();
  renderLandmarks();
  renderExtractLabels();
  renderPlayer();
  scheduleLootRender();
  renderBattlepass();
  scheduleDeclutter();
}

export function resetView() {
  assignView({ x: 0, y: 0, w: W, h: H });
  setView();
}

export function focusQuest(q, onlyId) {
  const pts = objectivePoints(q, onlyId);
  if (!pts.length) {
    toast(
      'This objective has no fixed ' +
        mapName(currentMapId) +
        ' location. Read the quest brief for its requirements.'
    );
    return;
  }
  const maps = pts.map(point);
  const minX = Math.min(...maps.map(p => p.x)),
    maxX = Math.max(...maps.map(p => p.x)),
    minY = Math.min(...maps.map(p => p.y)),
    maxY = Math.max(...maps.map(p => p.y));
  const w = Math.max(180, (maxX - minX) * 1.6),
    h = Math.max(100, (maxY - minY) * 1.6);
  assignView({ x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h });
  applyFloor(floorFor(pts[0]));
  setView();
  const label = pts.length + ' point' + (pts.length === 1 ? '' : 's');
  $('focus-label').textContent = q.name + ' · ' + label;
  toast('Showing ' + q.name + ' · ' + label + ' on the map.');
}

export function updateCompass() {
  const rotation = mapDefinition?.coordinateRotation || 0;
  $('north-arrow').style.transform = `rotate(${-rotation}deg)`;
}
