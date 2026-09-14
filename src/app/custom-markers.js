/*
 * custom-markers, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { ensureRaidData } from './my-raid.js';
import {
  assignEditingMarkerId,
  assignMarkerAdding,
  assignMarkerDraftPosition,
  bridge,
  currentMapId,
  data,
  editingMarkerId,
  markerDraftPosition
} from './state.js';

import { $, el, svg, toast, uiIcon } from './dom.js';
import { markerScale, point } from './geometry.js';
import { updateLayerCounts } from './map-layers.js';

export function setMarkerPlacement(active) {
  assignMarkerAdding(active);
  $('add-marker').classList.toggle('active', active);
  $('marker-mode-hint').hidden = !active;
  $('map-viewport').classList.toggle('placing-marker', active);
}

export function openMarkerEditor(position, marker = null) {
  assignMarkerDraftPosition(position);
  assignEditingMarkerId(marker?.id || null);
  $('marker-dialog-title').textContent = marker ? 'Edit marker' : 'Add marker';
  $('marker-name').value = marker?.name || '';
  $('marker-note').value = marker?.note || '';
  $('marker-error').textContent = '';
  $('marker-dialog').showModal();
  requestAnimationFrame(() => $('marker-name').focus());
}

export function closeMarkerEditor() {
  if ($('marker-dialog').open) $('marker-dialog').close();
  assignMarkerDraftPosition(null);
  assignEditingMarkerId(null);
}

export async function saveMarkerEditor(event) {
  event.preventDefault();
  const name = $('marker-name').value.trim(),
    note = $('marker-note').value.trim();
  if (!name) {
    $('marker-error').textContent = 'Give this marker a short name.';
    $('marker-name').focus();
    return;
  }
  if (!markerDraftPosition) {
    $('marker-error').textContent = 'Choose a place on the map again.';
    return;
  }
  const p = ensureRaidData(),
    current = p.customMarkers[currentMapId],
    previous = editingMarkerId ? current.find(item => item.id === editingMarkerId) : null,
    marker = {
      id: editingMarkerId || (crypto.randomUUID ? crypto.randomUUID() : 'marker-' + Date.now()),
      name: name.slice(0, 80),
      note: note.slice(0, 500),
      position: markerDraftPosition,
      createdAt: previous?.createdAt || Date.now()
    },
    next = editingMarkerId
      ? current.map(item => (item.id === editingMarkerId ? marker : item))
      : [...current, marker],
    button = $('save-marker');
  button.disabled = true;
  $('marker-error').textContent = '';
  try {
    await bridge.customMarkers({ mode: data.mode, map: currentMapId, markers: next });
    p.customMarkers[currentMapId] = next;
    closeMarkerEditor();
    renderCustomMarkers();
    toast(previous ? 'Marker updated.' : 'Marker added.');
  } catch (e) {
    $('marker-error').textContent = 'Could not save this marker. Try again.';
  } finally {
    button.disabled = false;
  }
}

export function renderCustomMarkers() {
  $('custom-markers').replaceChildren();
  updateLayerCounts();
  if (!$('layer-custom')?.checked) return;
  for (const marker of ensureRaidData().customMarkers[currentMapId]) {
    const pt = point(marker.position),
      s = markerScale(),
      g = svg('g', {
        transform: `translate(${pt.x} ${pt.y}) scale(${s})`,
        class: 'map-marker custom-map-marker',
        tabindex: '0',
        role: 'button',
        'aria-label': marker.name
      });
    g.append(
      svg('path', {
        d: 'M 0 -13 C -8 -13 -11 -6 -9 0 C -7 6 0 14 0 14 C 0 14 7 6 9 0 C 11 -6 8 -13 0 -13 Z',
        fill: '#d8a6f0',
        stroke: '#25182c',
        'stroke-width': 2
      })
    );
    g.append(svg('circle', { cx: 0, cy: -4, r: 3, fill: '#25182c' }));
    const title = svg('title');
    title.textContent = marker.name;
    g.append(title);
    const open = () => {
      const pop = $('map-popup');
      pop.replaceChildren();
      const close = el('button', 'icon-only popup-close');
      close.append(uiIcon('close'));
      close.setAttribute('aria-label', 'Close marker');
      close.onclick = () => (pop.hidden = true);
      const actions = el('div', 'marker-popup-actions'),
        edit = el('button', '');
      edit.append(uiIcon('edit'), el('span', '', 'Edit'));
      edit.onclick = () => {
        pop.hidden = true;
        openMarkerEditor(marker.position, marker);
      };
      const remove = el('button', 'danger-link');
      remove.append(uiIcon('trash'), el('span', '', 'Delete'));
      remove.onclick = async () => {
        const next = ensureRaidData().customMarkers[currentMapId].filter(
          item => item.id !== marker.id
        );
        remove.disabled = true;
        try {
          await bridge.customMarkers({ mode: data.mode, map: currentMapId, markers: next });
          ensureRaidData().customMarkers[currentMapId] = next;
          pop.hidden = true;
          renderCustomMarkers();
          toast('Marker deleted.');
        } catch {
          remove.disabled = false;
          toast('Could not delete the marker.', 'error');
        }
      };
      actions.append(edit, remove);
      pop.append(close, el('span', 'eyebrow', 'MY MARKER'), el('strong', '', marker.name));
      if (marker.note) pop.append(el('small', '', marker.note));
      pop.append(actions);
      pop.hidden = false;
    };
    g.onclick = e => {
      e.stopPropagation();
      open();
    };
    g.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    };
    $('custom-markers').append(g);
  }
}
