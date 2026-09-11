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
      results.push({ name, ok: !raised.length, detail: raised.length ? raised.join(' | ') : detail });
    } catch (error) {
      results.push({ name, ok: false, detail: error.message });
    }
  }
  const settle = async () => {
    for (let i = 0; i < 80 && !$('map-loading').hidden; i++) await wait(250);
    await wait(300);
  };
  async function openMap(id) {
    const loc = $('location');
    loc.value = id;
    loc.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  }
  const search = value => {
    const s = $('quest-search');
    s.value = value;
    s.dispatchEvent(new Event('input', { bubbles: true }));
  };
  async function pickQuest(name) {
    $('map-filter').value = '';
    $('map-filter').dispatchEvent(new Event('change', { bubbles: true }));
    $('status-filter').value = 'all';
    $('status-filter').dispatchEvent(new Event('change', { bubbles: true }));
    await wait(400);
    search(name);
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
    const titles = [...document.querySelectorAll('#details .section-title')].map(t => t.textContent);
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
    search('');
    await wait(400);
    $('show-active').click();
    await wait(800);
    const summary = document.querySelector('#details .active-summary');
    if (!summary) throw Error('no raid summary');
    const kit = document.querySelector('#details .raid-kit');
    const rows = kit ? kit.querySelectorAll('.raid-kit-row').length + ' kit rows' : 'no keys needed';
    return summary.querySelector('h2').textContent + ' · ' + rows;
  });

  await check('dashboard shows its panels', async () => {
    $('dashboard-button').click();
    await wait(800);
    const panels = [...document.querySelectorAll('#dashboard-content .dashboard-panel h3')].map(h => h.textContent);
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
