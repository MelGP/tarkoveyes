/* Battle Pass markers share the tactical map, floor selector and map popup. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id),
    ns = 'http://www.w3.org/2000/svg';
  const node = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const svg = (tag, attrs) => {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
  };
  const storageKey = 'raid-notes-battlepass-layers-v1';
  let catalog,
    registered,
    context = null,
    enabled = new Set(),
    selectedId = null;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(saved)) enabled = new Set(saved.filter(v => typeof v === 'string'));
  } catch {}
  const entries = () => {
    const map = catalog?.maps.find(m => m.id === context?.id),
      positions = registered?.maps.find(m => m.id === context?.id);
    return (
      map?.points.flatMap(p => {
        const pos = positions?.points.find(q => q.id === p.id);
        return pos ? [{ ...p, ...pos, sourceApproximate: p.approximate }] : [];
      }) || []
    );
  };
  const onFloor = p =>
    p.floor === context.floor ||
    (!context.floors.includes(p.floor) && context.floor === context.baseFloor);
  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...enabled]));
    } catch {}
  }
  function toggle(keys, on) {
    for (const key of keys) on ? enabled.add(key) : enabled.delete(key);
    save();
    refreshCategory();
    render();
    if (selectedId) {
      $('map-popup').hidden = true;
      selectedId = null;
    }
  }
  function refreshCategory() {
    if (!catalog || !context) return;
    const points = entries(),
      keys = Object.keys(catalog.categories),
      available = keys.filter(key => points.some(p => p.category === key));
    $('bp-spawn-count').textContent = points.length;
    $('bp-layer-types').replaceChildren();
    const all = $('layer-battlepass');
    all.disabled = !points.length;
    all.checked = available.length > 0 && available.every(k => enabled.has(k));
    all.indeterminate = available.some(k => enabled.has(k)) && !all.checked;
    $('bp-layer-note').textContent = points.length
      ? points.filter(onFloor).length +
        ' on this floor · ' +
        points.length +
        ' across all floors. Community alignment is approximate.'
      : 'No published Battle Pass spawns for this map.';
    for (const key of available) {
      const category = catalog.categories[key],
        group = points.filter(p => p.category === key),
        label = node('label', 'bp-layer-option'),
        input = node('input');
      input.type = 'checkbox';
      input.checked = enabled.has(key);
      input.setAttribute('aria-label', 'Show ' + category.label + ' Battle Pass spawns');
      input.onchange = () => toggle([key], input.checked);
      const icon = node('img');
      icon.src = category.icon;
      icon.alt = '';
      const text = node('span', '', category.label),
        count = node('b', '', group.filter(onFloor).length + '/' + group.length);
      count.title = 'Current floor / all floors';
      label.append(input, icon, text, count);
      $('bp-layer-types').append(label);
    }
    $('bp-floor-hint').textContent = points.length
      ? (context.floors.length > 1
          ? 'Use the map’s floor selector to see the other levels. '
          : '') + 'Click a marker for location photos.'
      : '';
  }
  function photoDialog(photo, name) {
    $('bp-full-photo').src = photo;
    $('bp-full-photo').alt = name;
    $('bp-photo-dialog').showModal();
  }
  function showPoint(point) {
    selectedId = point.id;
    const category = catalog.categories[point.category],
      pop = $('map-popup');
    pop.replaceChildren();
    const close = node('button', 'icon-only popup-close', '×');
    close.setAttribute('aria-label', 'Close Battle Pass spawn details');
    close.onclick = () => {
      pop.hidden = true;
      selectedId = null;
      render();
    };
    pop.append(
      close,
      node('span', 'eyebrow', 'BATTLE PASS SPAWN'),
      node('strong', '', category.name),
      node('small', '', point.floorLabel + ' · ' + point.id)
    );
    pop.append(
      node(
        'p',
        'bp-placement-note',
        'Approximate map alignment. Use the photos to identify the exact spot. Possible spawn, not guaranteed each raid.'
      )
    );
    if (point.region === 'mountain-bunker-entrance')
      pop.append(
        node(
          'p',
          'bp-placement-note',
          'Marker shows the bunker entrance. The document is underground, beyond the bathroom entrance.'
        )
      );
    if (point.sourceApproximate)
      pop.append(
        node(
          'p',
          'bp-placement-note',
          'The original source also marks this position as approximate.'
        )
      );
    if (point.note) pop.append(node('p', 'bp-note', point.note));
    const photos = node('div', 'bp-popup-photos');
    for (const [i, photo] of point.photos.entries()) {
      const button = node('button', 'bp-photo'),
        img = node('img');
      img.src = photo;
      img.alt = category.name + ' location photo ' + (i + 1);
      img.loading = 'lazy';
      button.title = 'Enlarge location photo';
      button.append(img);
      button.onclick = () => photoDialog(photo, img.alt);
      img.onerror = () => {
        button.replaceChildren(node('span', '', 'Photo unavailable'));
        button.disabled = true;
      };
      photos.append(button);
    }
    pop.append(photos);
    if (point.sourceNote) {
      const detail = node('details', 'bp-original-note'),
        summary = node(
          'summary',
          '',
          point.note ? 'Original note (Korean)' : 'Source note (Korean, not translated)'
        ),
        text = node('p', '', point.sourceNote);
      text.lang = 'ko';
      detail.append(summary, text);
      pop.append(detail);
    }
    pop.append(
      node(
        'small',
        'bp-popup-credit',
        'Locations & photos © Perofunyang · CC BY-NC 4.0 · Documents: tarkov.dev'
      )
    );
    pop.hidden = false;
    render();
  }
  function showCluster(points) {
    selectedId = null;
    const pop = $('map-popup');
    pop.replaceChildren();
    const close = node('button', 'icon-only popup-close', '×');
    close.setAttribute('aria-label', 'Close Battle Pass spawn list');
    close.onclick = () => (pop.hidden = true);
    pop.append(
      close,
      node('span', 'eyebrow', 'BATTLE PASS SPAWNS'),
      node('strong', '', points.length + ' nearby document locations')
    );
    const list = node('div', 'cluster-list');
    for (const p of points) {
      const button = node('button', 'bp-cluster-choice');
      button.append(
        node('strong', '', catalog.categories[p.category].label),
        node('small', '', p.floorLabel + ' · ' + p.id)
      );
      button.onclick = () => showPoint(p);
      list.append(button);
    }
    pop.append(list);
    pop.hidden = false;
  }
  function render() {
    const layer = $('battlepass-markers');
    if (!layer) return;
    layer.replaceChildren();
    if (!catalog || !context) return;
    const points = entries().filter(p => enabled.has(p.category) && onFloor(p)),
      scale = context.scale || 1,
      groups = [];
    for (const p of points) {
      const x = p.x * context.width,
        y = p.y * context.height,
        near = groups.find(g => Math.hypot(g.x - x, g.y - y) < 23 * scale);
      if (near) near.points.push(p);
      else groups.push({ x, y, points: [p] });
    }
    for (const group of groups) {
      const p = group.points[0],
        category = catalog.categories[p.category],
        multi = group.points.length > 1,
        name = multi
          ? group.points.length + ' nearby Battle Pass spawns'
          : category.name + ' · ' + p.floorLabel + ' · ' + p.id;
      const marker = svg('g', {
        class: 'map-marker battlepass-map-marker',
        transform: `translate(${group.x} ${group.y}) scale(${scale})`,
        tabindex: '0',
        role: 'button',
        'aria-label': name
      });
      const title = svg('title', {});
      title.textContent = name;
      marker.append(
        title,
        svg('circle', {
          r: 15,
          fill: '#172321',
          stroke: category.color,
          'stroke-width': selectedId === p.id ? 3 : 1.7,
          'stroke-dasharray': p.sourceApproximate ? '3 2' : ''
        })
      );
      marker.append(
        svg('image', {
          href: category.icon,
          x: -11,
          y: -11,
          width: 22,
          height: 22,
          'pointer-events': 'none'
        })
      );
      if (multi) {
        marker.append(
          svg('circle', {
            cx: 12,
            cy: -12,
            r: 8,
            fill: '#e7c987',
            stroke: '#20251f',
            'stroke-width': 1
          })
        );
        const count = svg('text', {
          x: 12,
          y: -9,
          'text-anchor': 'middle',
          fill: '#18211f',
          'font-size': 9,
          'font-weight': 700
        });
        count.textContent = group.points.length;
        marker.append(count);
      }
      const action = e => {
        e.stopPropagation();
        multi ? showCluster(group.points) : showPoint(p);
      };
      marker.onclick = action;
      marker.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          action(e);
        }
      };
      layer.append(marker);
    }
  }
  $('layer-battlepass').onchange = e =>
    toggle([...new Set(entries().map(p => p.category))], e.target.checked);
  $('bp-close-photo').onclick = () => $('bp-photo-dialog').close();
  window.battlepassLayer = {
    update(next) {
      const changed =
        context?.id !== next.id ||
        context?.floor !== next.floor ||
        context?.floors.join() !== next.floors.join();
      context = next;
      if (changed) {
        selectedId = null;
        refreshCategory();
      }
      render();
    },
    clear() {
      toggle(Object.keys(catalog?.categories || {}), false);
    },
    enableAll() {
      toggle(Object.keys(catalog?.categories || {}), true);
    }
  };
  Promise.all(
    ['battlepass-spawns.json', 'battlepass-placement.json'].map(file =>
      fetch('data/' + file).then(r => {
        if (!r.ok) throw Error('Missing Battle Pass data');
        return r.json();
      })
    )
  )
    .then(([data, positions]) => {
      if (
        positions.coordinateSystem !== 'normalized-tactical-artwork' ||
        positions.sourceCommit !== data.sourceCommit
      )
        throw Error('Incompatible Battle Pass registration');
      catalog = data;
      registered = positions;
      refreshCategory();
      render();
    })
    .catch(() => {
      $('bp-layer-note').textContent =
        'Battle Pass locations could not be loaded. Reopen the app to retry.';
    });
})();
