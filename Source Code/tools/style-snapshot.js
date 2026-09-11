/*
 * Computed-style regression harness for the renderer.
 *
 * Not part of the application: paste this whole file into the console of the
 * local preview (npm run preview, then http://127.0.0.1:4318/).
 *
 *   1. Run it once before a CSS or markup change. It walks nine scenes and
 *      stores every element's computed style in localStorage as the baseline.
 *   2. Make the change, reload, run it again. It reports every element whose
 *      computed style moved, property by property.
 *
 * Element identity is a structural path (tag, id and position among siblings),
 * so adding or removing a <link> in <head> does not shift every key.
 * Keep the browser at the same window size for both runs: widths are compared.
 * localStorage.removeItem('raid-notes-style-baseline-v2') starts over.
 */
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const PROPS = [
    'display','position','color','background-color','background-image',
    'border-top-width','border-right-width','border-bottom-width','border-left-width',
    'border-top-color','border-left-color','border-top-left-radius',
    'font-family','font-size','font-weight','line-height','letter-spacing','text-transform',
    'padding-top','padding-right','padding-bottom','padding-left',
    'margin-top','margin-right','margin-bottom','margin-left',
    'width','height','min-width','min-height',
    'flex-direction','justify-content','align-items','gap','grid-template-columns',
    'opacity','box-shadow','overflow-x','overflow-y','z-index','visibility','text-align','white-space'
  ];

  function key(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const p = n.parentElement;
      const i = p ? [...p.children].indexOf(n) + 1 : 1;
      parts.unshift(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + ':' + i);
    }
    return parts.join('>');
  }
  function snap() {
    const out = {};
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      out[key(el)] = PROPS.map(p => cs.getPropertyValue(p)).join('|');
    }
    return out;
  }
  async function firstCard() {
    for (let i = 0; i < 30; i++) {
      const c = document.querySelector('#quest-list button, #quest-list .quest-card');
      if (c) return c;
      await wait(200);
    }
    return null;
  }
  async function setFilters(map, status) {
    const m = document.getElementById('map-filter'), s = document.getElementById('status-filter');
    m.value = map; m.dispatchEvent(new Event('change', { bubbles: true }));
    s.value = status; s.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(400);
  }
  const closeDialogs = () => document.querySelectorAll('dialog').forEach(d => d.open && d.close());
  const search = value => {
    const s = document.getElementById('quest-search');
    s.value = value; s.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const scenes = {
    async main() {
      closeDialogs();
      const loc = document.getElementById('location');
      loc.value = 'customs'; loc.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 60 && !document.getElementById('map-loading').hidden; i++) await wait(250);
      await setFilters('', 'all');
      search('');
      await wait(600);
    },
    async quest() { search('Background Check'); const c = await firstCard(); if (c) c.click(); await wait(700); },
    async layers() {
      document.querySelector('.layer-disclosure').open = true;
      document.querySelectorAll('.loot-layer-group').forEach(d => (d.open = true));
      await wait(500);
    },
    async raid() {
      document.querySelector('.layer-disclosure').open = false;
      document.querySelectorAll('.loot-layer-group').forEach(d => (d.open = false));
      search(''); await wait(300);
      document.getElementById('show-active').click();
      await wait(800);
    },
    async dashboard() { closeDialogs(); document.getElementById('dashboard-button').click(); await wait(800); },
    async items() { closeDialogs(); document.getElementById('items-button').click(); await wait(800); },
    async connection() { closeDialogs(); document.getElementById('setup-tab').click(); await wait(600); },
    async about() { closeDialogs(); document.getElementById('about-button').click(); await wait(500); },
    async command() { closeDialogs(); document.getElementById('quick-find').click(); await wait(600); }
  };

  const store = 'raid-notes-style-baseline-v2';
  const baseline = JSON.parse(localStorage.getItem(store) || 'null');
  const taken = {};
  for (const [name, run] of Object.entries(scenes)) { await run(); taken[name] = snap(); }
  closeDialogs();

  if (!baseline) {
    localStorage.setItem(store, JSON.stringify(taken));
    const counts = Object.fromEntries(Object.entries(taken).map(([k, v]) => [k, Object.keys(v).length]));
    console.log('baseline stored', counts);
    return counts;
  }
  const diffs = [];
  for (const name of Object.keys(scenes)) {
    const before = baseline[name] || {}, after = taken[name] || {};
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[k] === after[k]) continue;
      if (!(k in before)) { diffs.push({ scene: name, el: k, change: 'added' }); continue; }
      if (!(k in after)) { diffs.push({ scene: name, el: k, change: 'removed' }); continue; }
      const b = before[k].split('|'), a = after[k].split('|');
      diffs.push({
        scene: name, el: k,
        change: PROPS.map((p, i) => (b[i] === a[i] ? null : p + ': ' + b[i] + ' -> ' + a[i])).filter(Boolean).join('; ')
      });
    }
  }
  console.log(diffs.length ? diffs : 'no computed-style differences');
  return { totalDiffs: diffs.length, diffs: diffs.slice(0, 40) };
})();
