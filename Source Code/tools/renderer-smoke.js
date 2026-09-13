/*
 * Renderer smoke check.
 *
 * The Node suite proves the data and the assets are there; it never renders
 * anything. This script does: paste it into the console of the local preview
 * (npm run preview, then http://127.0.0.1:4318/) and it drives the real UI.
 *
 * It loads every bundled map, switches floors, opens a quest brief, follows a
 * cross-map jump, builds My Raid, opens the dashboard, searches quick find and
 * toggles the Battle Pass layer, then prints one line per check. Any thrown
 * error or console error during the run fails the check that caused it.
 *
 * It only reads and navigates. It changes no saved progress, though it does
 * leave the UI on the last map it visited.
 */
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const results = [];
  const errors = [];
  const onError = e => errors.push(e.message || String(e.reason || e));
  addEventListener('error', onError);
  addEventListener('unhandledrejection', onError);

  async function check(name, fn) {
    const before = errors.length;
    try {
      const detail = await fn();
      const raised = errors.slice(before);
      results.push({
        name,
        ok: !raised.length,
        detail: raised.length ? raised.join(' | ') : detail
      });
    } catch (error) {
      results.push({ name, ok: false, detail: error.message });
    }
  }
  const settle = async () => {
    for (let i = 0; i < 80 && !$('map-loading').hidden; i++) await wait(250);
    await wait(300);
  };

  /* Start from a known screen. The checks used to inherit whatever the last
     person or script left behind - a status filter on "active", map focus on, a
     dialog open - and then fail for a reason that had nothing to do with the
     code. A check that can fail because of where the application happened to be
     is not telling you anything. */
  async function resetToDefaults() {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    const main = document.querySelector('main');
    if (main.classList.contains('map-focus')) {
      $('focus-map').click();
      await wait(400);
    }
    $('quest-search').value = '';
    $('quest-search').dispatchEvent(new Event('input', { bubbles: true }));
    $('status-filter').value = 'open';
    $('status-filter').dispatchEvent(new Event('change', { bubbles: true }));
    $('trader').value = '';
    $('trader').dispatchEvent(new Event('change', { bubbles: true }));
    if ($('path-filter')) {
      $('path-filter').value = 'all';
      $('path-filter').dispatchEvent(new Event('change', { bubbles: true }));
    }
    const drawer = document.querySelector('.layer-disclosure');
    if (drawer) drawer.open = false;
    $('map-popup').hidden = true;
    await wait(600);
  }
  await resetToDefaults();
  async function openMap(id) {
    const loc = $('location');
    loc.value = id;
    loc.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  }
  /* The quest search waits for a pause in typing before it redraws the list,
     so a test that types and then grabs the first row grabs the row that was
     there before. Await this rather than calling it bare. */
  const search = async value => {
    const s = $('quest-search');
    s.value = value;
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(220);
  };
  async function pickQuest(name) {
    $('map-filter').value = '';
    $('map-filter').dispatchEvent(new Event('change', { bubbles: true }));
    $('status-filter').value = 'all';
    $('status-filter').dispatchEvent(new Event('change', { bubbles: true }));
    await wait(400);
    await search(name);
    for (let i = 0; i < 30; i++) {
      const card = document.querySelector('#quest-list button, #quest-list .quest-card');
      if (card) {
        card.click();
        await wait(600);
        return true;
      }
      await wait(200);
    }
    return false;
  }

  const maps = [...$('location').options].map(o => o.value);
  await check('map registry is populated', () => {
    if (maps.length < 13) throw Error('only ' + maps.length + ' maps in the selector');
    return maps.length + ' maps';
  });

  for (const id of maps) {
    await check('map loads: ' + id, async () => {
      await openMap(id);
      if ($('location').value !== id) throw Error('selector did not settle on ' + id);
      if (!$('artwork').childElementCount) throw Error('no artwork rendered');
      const box = $('map-svg').getAttribute('viewBox');
      if (!box || /NaN/.test(box)) throw Error('bad viewBox: ' + box);
      return $('artwork').childElementCount + ' artwork nodes';
    });
  }

  await check('floors switch where a map has them', async () => {
    await openMap('interchange');
    const floor = $('floor');
    if (floor.options.length < 2) return 'single-floor in this build';
    const first = floor.value;
    floor.value = floor.options[floor.options.length - 1].value;
    floor.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(600);
    if (floor.value === first) throw Error('floor did not change');
    return first + ' -> ' + floor.value;
  });

  await check('quest brief renders its objectives', async () => {
    if (!(await pickQuest('Background Check'))) throw Error('quest not found in the list');
    const titles = [...document.querySelectorAll('#details .section-title')].map(
      t => t.textContent
    );
    if (!titles.some(t => /OBJECTIVES/.test(t))) throw Error('no objectives section');
    return titles.join(' / ');
  });

  await check('a quest on another map offers the jump', async () => {
    await openMap('customs');
    if (!(await pickQuest('A Big Loss'))) throw Error('quest not found');
    const cta = document.querySelector('#details .detail-head button.primary');
    if (cta.disabled) throw Error('jump button is disabled: ' + cta.textContent);
    cta.click();
    await settle();
    if ($('location').value === 'customs') throw Error('map did not switch');
    return cta.textContent.trim() + ' -> ' + $('location').value;
  });

  await check('My Raid lists its quests and the keys they need', async () => {
    await openMap('customs');
    await search('');
    await wait(400);
    $('show-active').click();
    await wait(800);
    const summary = document.querySelector('#details .active-summary');
    if (!summary) throw Error('no raid summary');
    const kit = document.querySelector('#details .raid-kit');
    const rows = kit
      ? kit.querySelectorAll('.raid-kit-row').length + ' kit rows'
      : 'no keys needed';
    return summary.querySelector('h2').textContent + ' · ' + rows;
  });

  await check('dashboard shows its panels', async () => {
    $('dashboard-button').click();
    await wait(800);
    const panels = [...document.querySelectorAll('#dashboard-content .dashboard-panel h3')].map(
      h => h.textContent
    );
    $('dashboard-dialog').close();
    for (const wanted of ['Where to go next', 'Ready to start', 'Progress'])
      if (!panels.includes(wanted)) throw Error('missing panel: ' + wanted);
    return panels.join(' / ');
  });

  await check('quick find returns matches', async () => {
    $('quick-find').click();
    await wait(400);
    const input = $('command-search');
    input.value = 'dorm';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(600);
    const count = document.querySelectorAll('#command-results .command-result').length;
    $('command-dialog').close();
    if (!count) throw Error('no results for "dorm"');
    return count + ' results';
  });

  await check('Battle Pass layer renders markers', async () => {
    const master = $('layer-battlepass');
    if (!master) throw Error('no Battle Pass layer control');
    if (master.disabled) return 'layer disabled for this map';
    if (!master.checked) {
      master.checked = true;
      master.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await wait(800);
    const count = $('battlepass-markers').childElementCount;
    if (!count) throw Error('layer on but nothing drawn');
    return count + ' markers';
  });

  /* The rail layout, added 12 September 2026. These four are the parts of it
     that are easy to break from a distance: the card is positioned by script
     rather than by the grid, and nothing else in this file would notice if it
     stopped being positioned at all. Each one is a no-op below 1101px, where
     the brief is still a panel. */
  const wideLayout = matchMedia('(min-width: 1101px)').matches;

  await check('the brief is a card beside the rail, not a column', async () => {
    if (!wideLayout) return 'narrow layout, brief is a panel';
    const list = $('quest-list').querySelectorAll('.quest-row');
    if (!list.length) throw Error('no quests to open');
    list[0].click();
    await wait(900);
    const rail = document.querySelector('.sidebar').getBoundingClientRect();
    const card = $('details').getBoundingClientRect();
    if (card.left < rail.right) throw Error('brief overlaps the rail');
    if (card.left > rail.right + 40)
      throw Error('brief is ' + Math.round(card.left - rail.right) + 'px from the rail');
    if (card.right > innerWidth)
      throw Error('brief runs off the window at ' + Math.round(card.right));
    return (
      Math.round(card.width) + 'px wide, ' + Math.round(card.left - rail.right) + 'px from the rail'
    );
  });

  await check('the brief points at the row you picked', async () => {
    if (!wideLayout) return 'narrow layout, brief does not move';
    const stage = document.querySelector('main');
    /* Ask what alignBrief() asks. The classes can disagree with the module
       variables, and a guard that reads the DOM then 'fixes' the wrong one
       leaves the real blocker in place. */
    const focusOn = () =>
      typeof mapFocus === 'boolean' ? mapFocus : stage.classList.contains('map-focus');
    const briefShut = () =>
      typeof detailsCollapsed === 'boolean'
        ? detailsCollapsed
        : stage.classList.contains('details-collapsed');
    if (focusOn()) {
      $('focus-map').click();
      await wait(500);
    }
    if (briefShut()) {
      $('toggle-details').click();
      await wait(600);
    }
    if (focusOn() || briefShut())
      throw Error(
        'could not open the brief: mapFocus=' + focusOn() + ' detailsCollapsed=' + briefShut()
      );

    const rows = [...$('quest-list').querySelectorAll('.quest-row')];
    if (rows.length < 4) return 'too few quests to tell';
    /* The card is capped, so a row far down the rail clamps it and the card
       stops moving - that is the design. What holds for every row is that the
       notch points at the row the card is showing. */
    const readings = [];
    for (const index of [0, 2, Math.min(rows.length - 1, 5)]) {
      rows[index].click();
      await wait(900);
      if (!stage.classList.contains('brief-tied')) {
        readings.push('row ' + index + ': not tied');
        continue;
      }
      const after = getComputedStyle(stage, ':after');
      const notchTop = parseFloat(after.top);
      const notchHeight = parseFloat(after.height) || 0;
      const stageBox = stage.getBoundingClientRect();
      const centre = stageBox.top + notchTop + notchHeight / 2;
      const rowBox = rows[index].getBoundingClientRect();
      const rowCentre = rowBox.top + rowBox.height / 2;
      const off = Math.round(centre - rowCentre);
      if (Math.abs(off) > 4)
        throw Error(
          'the notch missed row ' +
            index +
            ' by ' +
            off +
            'px (notch ' +
            Math.round(centre) +
            ', row ' +
            Math.round(rowCentre) +
            ')'
        );
      readings.push('row ' + index + ' off by ' + off + 'px');
    }
    return readings.join(', ');
  });

  await check('nothing on the map hides under a panel', async () => {
    const panels = ['.sidebar', '#details'].map(s => document.querySelector(s)).filter(Boolean);
    const floats = [
      '#focus-label',
      '.toolbar-actions',
      '.position-bar',
      '.zoom-controls',
      '.north'
    ];
    const live = el => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;
    };
    const buried = [];
    for (const p of panels) {
      const pb = live(p);
      if (!pb) continue;
      for (const s of floats) {
        for (const el of document.querySelectorAll(s)) {
          const fb = live(el);
          if (!fb) continue;
          const w = Math.min(pb.right, fb.right) - Math.max(pb.left, fb.left);
          const h = Math.min(pb.bottom, fb.bottom) - Math.max(pb.top, fb.top);
          if (w > 1 && h > 1) buried.push(s);
        }
      }
    }
    if (buried.length) throw Error('under a panel: ' + [...new Set(buried)].join(', '));
    return 'all clear';
  });

  await check('the rail is the same width whatever else is open', async () => {
    if (!wideLayout) return 'narrow layout, no rail';
    const main = document.querySelector('main');
    const width = () =>
      Math.round(document.querySelector('.sidebar').getBoundingClientRect().width);
    if (main.classList.contains('map-focus')) {
      $('focus-map').click();
      await wait(500);
    }
    if (main.classList.contains('details-collapsed')) {
      $('toggle-details').click();
      await wait(600);
    }
    const open = width();
    $('toggle-details').click();
    await wait(700);
    const closed = width();
    $('toggle-details').click();
    await wait(700);
    const reopened = width();
    if (open !== closed || open !== reopened)
      throw Error(
        'rail moves: ' + open + ' open, ' + closed + ' closed, ' + reopened + ' reopened'
      );
    return open + 'px throughout';
  });

  await check('Escape takes one thing off the screen at a time', async () => {
    const esc = async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(320);
    };
    const showing = () =>
      (!$('map-popup').hidden ? 1 : 0) +
      (document.querySelector('.layer-disclosure[open]') ? 1 : 0) +
      (!document.querySelector('main').classList.contains('details-collapsed') ? 1 : 0);
    document.querySelector('.layer-disclosure').open = true;
    await wait(400);
    const steps = [showing()];
    for (let i = 0; i < 3; i++) {
      await esc();
      steps.push(showing());
    }
    for (let i = 1; i < steps.length; i++)
      if (steps[i] > steps[i - 1]) throw Error('a press added something: ' + steps.join(' > '));
    if (steps[steps.length - 1] !== 0)
      throw Error('something survived four presses: ' + steps.join(' > '));
    return steps.join(' > ');
  });

  await check('the layer legend is the colour the map draws', async () => {
    // The layer icons keep their colour only because they match the layer.
    // Measured once, none of them did: three sets of values for two concepts.
    for (const box of document.querySelectorAll('.layers input[type=checkbox]')) {
      const label = (box.closest('label')?.textContent || '').toLowerCase();
      if (/extract|transit/.test(label) && !box.checked) {
        box.checked = true;
        box.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    await wait(900);
    const swatches = new Set();
    for (const icon of document.querySelectorAll('.layers .icon')) {
      const text = (icon.parentElement?.textContent || '').trim();
      if (/extract|transit/i.test(text)) swatches.add(getComputedStyle(icon).color);
    }
    const strokes = new Set();
    for (const marker of document.querySelectorAll('#markers > *')) {
      const shape = marker.querySelector('circle,path,rect,polygon');
      if (shape) strokes.add(getComputedStyle(shape).stroke);
    }
    if (!swatches.size) throw Error('no extract or transit swatches found');
    const orphans = [...swatches].filter(c => !strokes.has(c));
    if (orphans.length)
      throw Error(
        'swatch the map never draws: ' +
          orphans.join(', ') +
          '  (map draws ' +
          [...strokes].join(', ') +
          ')'
      );
    return swatches.size + ' swatches, all drawn on the map';
  });

  await check('a failed toast does not look like a confirmation', async () => {
    const el = $('toast');
    toast('Marker added.');
    await wait(150);
    const good = getComputedStyle(el);
    const goodLook = good.backgroundColor + ' ' + good.boxShadow;
    const goodRole = el.getAttribute('role');
    toast('Could not save progress.', 'error');
    await wait(150);
    const bad = getComputedStyle(el);
    const badLook = bad.backgroundColor + ' ' + bad.boxShadow;
    const badRole = el.getAttribute('role');
    toast('Marker updated.');
    await wait(150);
    const cleared = !el.classList.contains('toast-error') && el.getAttribute('role') === 'status';
    el.hidden = true;
    if (goodLook === badLook) throw Error('a failure is painted like a confirmation: ' + goodLook);
    if (badRole !== 'alert') throw Error('a failure does not interrupt, role is ' + badRole);
    if (goodRole !== 'status') throw Error('a confirmation interrupts, role is ' + goodRole);
    if (!cleared) throw Error('the error tone survived the next toast');
    return 'confirmation status, failure alert, tone cleared after';
  });

  await check('My Raid never empties the journal', async () => {
    // The button that answers "what am I doing this raid" used to narrow the
    // filter to Active unconditionally, so on a map with nothing active it hid
    // every quest behind "No quests match these filters".
    await resetToDefaults();
    const before = document.querySelectorAll('.quest-row').length;
    if (!before) throw Error('the rail was already empty before My Raid');
    $('show-active').click();
    await wait(900);
    const after = document.querySelectorAll('.quest-row').length;
    const status = $('status-filter').value;
    await resetToDefaults();
    if (!after)
      throw Error(
        'My Raid emptied the rail: ' + before + ' rows -> 0, filter now "' + status + '"'
      );
    return before + ' rows -> ' + after + ', filter "' + status + '"';
  });

  await check('Focus gives the map the window, it does not take it away', async () => {
    // Reported as "when I put it fullscreen this happens". It was Focus, at any
    // size: `.map-focus .map-area { grid-column: 1 }` survived the rail layout
    // giving `main` a second column, so the map was pinned to the 256px rail
    // column - 13% of a 1920px window, from the button whose job is the opposite.
    await resetToDefaults();
    const map = () => $('map-viewport').getBoundingClientRect().width;
    const before = map();
    const main = document.querySelector('main');
    if (main.classList.contains('map-focus')) {
      $('focus-map').click();
      await wait(500);
    }
    const unfocused = map();
    $('focus-map').click();
    await wait(600);
    const focused = map();
    const placement = getComputedStyle($('map-viewport').closest('.map-area')).gridColumn;
    $('focus-map').click();
    await wait(500);
    if (focused < unfocused - 1)
      throw Error(
        'Focus made the map narrower: ' +
          Math.round(unfocused) +
          'px -> ' +
          Math.round(focused) +
          'px, grid-column "' +
          placement +
          '"'
      );
    if (focused < innerWidth * 0.9)
      throw Error(
        'Focus left the map at ' + Math.round((focused / innerWidth) * 100) + '% of the window'
      );
    return (
      Math.round(unfocused) +
      'px -> ' +
      Math.round(focused) +
      'px (' +
      Math.round((focused / innerWidth) * 100) +
      '% of the window)'
    );
  });

  await check('F focuses the map, even right after using a dropdown', async () => {
    // A <select> keeps focus after you pick from it and spends letter keys on
    // type-ahead, so F was dead from the moment you chose a map - the first
    // thing anyone does. The fix hands focus back after a pointer-driven
    // change; this check is here because the failure is silent.
    await resetToDefaults();
    const main = document.querySelector('main');
    if (main.classList.contains('map-focus')) {
      $('focus-map').click();
      await wait(400);
    }
    const picker = $('status-filter');
    picker.focus();
    picker.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    picker.value = 'all';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(900);
    const stillHoldingFocus = document.activeElement === picker;

    const tap = () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    tap();
    await wait(450);
    const entered = main.classList.contains('map-focus');
    tap();
    await wait(450);
    const left = !main.classList.contains('map-focus');
    await resetToDefaults();

    if (stillHoldingFocus)
      throw Error('the dropdown kept focus after a mouse change, so F is dead');
    if (!entered) throw Error('F did not enter map focus');
    if (!left) throw Error('F did not leave map focus');
    return 'toggles both ways with a dropdown just used';
  });

  await check('only the bars that lead somewhere look pressable', async () => {
    // Three of the five Progress bars are a reading, not a route: most quests
    // have no prerequisite, so a depth tree of them was one column holding
    // 59%, 41% and 86% of the set. Those are plain rows. The two real routes
    // are buttons and open a tree that ends on the route.
    await resetToDefaults();
    $('dashboard-button').click();
    await wait(1200);
    const bars = [...document.querySelectorAll('.dashboard-progress')];
    if (!bars.length) throw Error('no progress bars in the dashboard');

    const pressable = [];
    const readings = [];
    for (const bar of bars) {
      const label = bar.querySelector('span')?.textContent || '(unlabelled)';
      if (bar.tagName === 'BUTTON') pressable.push(label);
      else {
        // a row that does nothing must not invite a click
        if (bar.onclick) throw Error(label + ' is not a button but still has a click handler');
        if (getComputedStyle(bar).cursor === 'pointer')
          throw Error(label + ' is not pressable but shows a pointer cursor');
        readings.push(label);
      }
    }
    if (!pressable.length) throw Error('no route bar is pressable any more');

    for (const label of pressable) {
      if (!$('dashboard-dialog').open) {
        document.querySelectorAll('dialog[open]').forEach(d => d.close());
        $('dashboard-button').click();
        await wait(1000);
      }
      const bar = [...document.querySelectorAll('.dashboard-progress')].find(
        b => b.querySelector('span')?.textContent === label
      );
      bar.click();
      await wait(1300);
      if (!$('chain-dialog').open) throw Error(label + ' did not open its tree');
      const columns = [...document.querySelectorAll('#chain-content .chain-band')];
      const nodes = document.querySelectorAll('#chain-content .chain-node').length;
      if (!columns.length || !nodes) throw Error(label + ' opened an empty tree');
      const biggest = Math.max(...columns.map(c => c.querySelectorAll('.chain-node').length));
      // a tree whose widest step holds most of the set is a list wearing a
      // tree, which is exactly why the other three are not buttons
      if (biggest / nodes > 0.5)
        throw Error(
          label + ' is not shaped like a route: ' + biggest + ' of its ' + nodes + ' quests are in one column'
        );
      // and a quest inside it opens its own chain, so the two views connect
      const node = document.querySelector('#chain-content .chain-node');
      const name = node.querySelector('.chain-name')?.textContent;
      node.click();
      await wait(1000);
      if ($('chain-title').textContent !== name)
        throw Error('clicking ' + name + ' in ' + label + ' did not open its own chain');
      $('chain-dialog').close();
      await wait(250);
    }
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    await resetToDefaults();
    return pressable.length + ' routes (' + pressable.join(', ') + '), ' + readings.length + ' readings';
  });

  removeEventListener('error', onError);
  removeEventListener('unhandledrejection', onError);
  const failed = results.filter(r => !r.ok);
  for (const r of results)
    console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail ? '  -  ' + r.detail : ''));
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  const summary = { passed: results.length - failed.length, total: results.length, failed };
  window.rendererSmokeResult = summary; // also readable after loading this file as a <script>
  return summary;
})();
