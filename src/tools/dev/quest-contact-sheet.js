/* Every bundled quest picture on one searchable page.
 *
 * The 515 files in app/assets/quests are named by task id, so the folder tells
 * you nothing about what is in it. This writes a grid that puts the quest name,
 * the trader and the catalogues beside each picture.
 *
 * The page links the images rather than embedding them: 28.7 MB of WebP would
 * not survive as data: URIs, and the pictures are already on disk next to it.
 * That is why the output belongs in Documentation/ and nowhere else - the
 * relative path back to app/assets/quests is baked in.
 *
 *   node tools/dev/quest-contact-sheet.js            write the page
 *   node tools/dev/quest-contact-sheet.js --check    report without writing
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const data = path.join(root, 'app/data');
const art = path.join(root, 'app/assets/quests');
const out = path.resolve(root, '../Documentation/quest-pictures.html');
const checkOnly = process.argv.includes('--check');

const images = JSON.parse(fs.readFileSync(path.join(data, 'quest-images.json'), 'utf8')).images;

/* A task id can sit in all three catalogues and the name is the same in each,
   so the first one wins and the rest only record which modes carry it.
   Seasonal leads because that is the profile in play. */
const meta = new Map();
for (const [mode, file] of [
  ['seasonal', 'quests-seasonal.json'],
  ['pvp', 'quests.json'],
  ['pve', 'quests-pve.json']
]) {
  const raw = JSON.parse(fs.readFileSync(path.join(data, file), 'utf8'));
  for (const q of Array.isArray(raw) ? raw : raw.quests || raw.tasks) {
    if (!meta.has(q.id))
      meta.set(q.id, {
        name: q.name,
        trader: q.traderName || '',
        faction: q.faction || '',
        modes: []
      });
    meta.get(q.id).modes.push(mode);
  }
}

const orphans = [];
const cards = Object.keys(images)
  .map(id => {
    const file = path.join(art, id + '.webp');
    if (!fs.existsSync(file)) orphans.push(id);
    const m = meta.get(id) || {
      name: '(in no bundled catalogue)',
      trader: '',
      faction: '',
      modes: []
    };
    return {
      id,
      name: m.name,
      trader: m.trader,
      faction: m.faction,
      modes: m.modes,
      kb: fs.existsSync(file) ? Math.round(fs.statSync(file).size / 1024) : 0,
      src: '../src/app/assets/quests/' + id + '.webp'
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

const totalMb = (cards.reduce((n, c) => n + c.kb, 0) / 1024).toFixed(1);
const named = cards.filter(c => meta.has(c.id)).length;

console.log(cards.length + ' pictures, ' + totalMb + ' MB');
console.log(named + ' resolve to a quest name, ' + (cards.length - named) + ' do not');
if (orphans.length)
  console.log('listed with no file on disk: ' + orphans.length + ' (' + orphans.join(', ') + ')');
if (checkOnly) {
  console.log('--check: nothing written.');
  process.exit(0);
}

const page = `<!doctype html>
<meta charset="utf-8">
<title>TarkovEyes - quest pictures</title>
<style>
  :root { --bg:#111417; --card:#181c20; --line:#262b30; --ink1:#f2f4f5; --ink5:#8e959b; --live:#e9b969 }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink1);
         font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif }
  header { position:sticky; top:0; z-index:2; background:rgba(17,20,23,.94);
           backdrop-filter:blur(8px); border-bottom:1px solid var(--line); padding:14px 20px }
  h1 { margin:0 0 2px; font-size:16px; letter-spacing:.2px }
  .sub { color:var(--ink5); font-size:12px }
  .tools { display:flex; gap:10px; align-items:center; margin-top:10px; flex-wrap:wrap }
  input, select { background:#0e1114; color:var(--ink1); border:1px solid var(--line);
                  border-radius:6px; padding:7px 10px; font:inherit; font-size:13px }
  input { min-width:260px }
  #count { color:var(--live); font-size:12px; font-variant-numeric:tabular-nums }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(228px,1fr)); gap:14px; padding:18px 20px 60px }
  figure { margin:0; background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden }
  figure img { display:block; width:100%; aspect-ratio:314/177; object-fit:cover; background:#0b0e10 }
  figcaption { padding:8px 10px 10px }
  .name { font-size:13px; line-height:1.3 }
  .who { color:var(--ink5); font-size:11px; margin-top:3px; text-transform:uppercase; letter-spacing:.6px }
  .id { color:#5c6369; font-size:10px; font-family:ui-monospace,Consolas,monospace; margin-top:4px;
        user-select:all; word-break:break-all }
  .empty { padding:40px 20px; color:var(--ink5) }
</style>
<header>
  <h1>Quest pictures</h1>
  <div class="sub">${cards.length} bundled pictures &middot; ${totalMb} MB &middot; src/app/assets/quests &middot; each one is the banner at the top of that quest's brief</div>
  <div class="tools">
    <input id="q" type="search" placeholder="Search a quest or a trader&hellip;" autofocus>
    <select id="trader"><option value="">All traders</option></select>
    <select id="mode">
      <option value="">All catalogues</option>
      <option value="seasonal">Seasonal</option>
      <option value="pvp">PvP</option>
      <option value="pve">PvE</option>
    </select>
    <span id="count"></span>
  </div>
</header>
<div class="grid" id="grid"></div>
<script>
const cards = ${JSON.stringify(cards)};
const grid = document.getElementById('grid');
const q = document.getElementById('q');
const traderSel = document.getElementById('trader');
const modeSel = document.getElementById('mode');
const count = document.getElementById('count');

for (const t of [...new Set(cards.map(c => c.trader).filter(Boolean))].sort())
  traderSel.append(new Option(t, t));

function draw() {
  const needle = q.value.trim().toLowerCase();
  const trader = traderSel.value, mode = modeSel.value;
  const shown = cards.filter(c =>
    (!needle || (c.name + ' ' + c.trader).toLowerCase().includes(needle)) &&
    (!trader || c.trader === trader) &&
    (!mode || c.modes.includes(mode)));
  count.textContent = shown.length + ' of ' + cards.length;
  grid.replaceChildren();
  if (!shown.length) {
    const p = document.createElement('div');
    p.className = 'empty';
    p.textContent = 'Nothing matches.';
    grid.append(p);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const c of shown) {
    const fig = document.createElement('figure');
    const img = document.createElement('img');
    img.src = c.src; img.loading = 'lazy'; img.alt = ''; img.title = c.name;
    const cap = document.createElement('figcaption');
    const name = document.createElement('div');
    name.className = 'name'; name.textContent = c.name;
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = [c.trader, c.faction, c.modes.join('/'), c.kb + ' KB'].filter(Boolean).join(' · ');
    const id = document.createElement('div');
    id.className = 'id'; id.textContent = c.id;
    cap.append(name, who, id);
    fig.append(img, cap);
    frag.append(fig);
  }
  grid.append(frag);
}
q.oninput = traderSel.onchange = modeSel.onchange = draw;
draw();
</script>
`;

fs.writeFileSync(out, page);
console.log('wrote ' + path.relative(path.resolve(root, '..'), out));
