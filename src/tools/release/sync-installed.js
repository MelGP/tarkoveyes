/*
 * Syncs the canonical src runtime files into App/resources/app and
 * refreshes Documentation/SHA256.json for exactly the paths that changed.
 *
 *   node tools/release/sync-installed.js --check   report differences, write nothing
 *   node tools/release/sync-installed.js           copy the differences and update the manifest
 *
 * Only files the installed application actually runs are considered. Test files,
 * tools, the preview server and node_modules are deliberately left out: the
 * installed copy gets its dependencies from the packaging step, not from here.
 *
 * The manifest is reconciled against the disk as well as against the two
 * trees. An entry whose file is absent is stale - which is what a file
 * deleted from source and installed before a run leaves behind, invisible to
 * the removal sweep because there is nothing left to compare.
 *
 * package.json is also left out on purpose. tools/release/package.js writes a trimmed
 * manifest (no scripts, no devDependencies) into the installed copy, so copying
 * the source file over it would undo the packaging step.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const source = path.join(import.meta.dirname, '../..');
const root = path.join(source, '..');
const installed = path.join(root, 'App', 'resources', 'app');
const manifestPath = path.join(root, 'Documentation', 'SHA256.json');
/* Whole directories, so a new module in main/ or lib/ ships without anyone
 * remembering to list it. Shipping templates.js unlisted killed the
 * installed application on launch with "Cannot find module", and the same
 * trap caught paths.js the day it was written. */
const runtimeDirs = ['app', 'lib', 'main', 'licenses'];
const runtimeFiles = ['LICENSE', 'THIRD-PARTY.md'];
const check = process.argv.includes('--check');

/* With no built copy beside src/ there is nothing to sync into, and listing
   all 1653 runtime files as "new in source" reads like the tool is about to do
   something useful. Say what is actually the matter and stop. */
if (!fs.existsSync(installed)) {
  console.log('No built copy to sync: ' + path.relative(root, installed) + ' does not exist.');
  console.log(
    'Run "npm run package" first, or copy a built app to ' +
      path.relative(root, path.join(root, 'App')) +
      '.'
  );
  process.exit(0);
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function walk(dir, base, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}
function runtimePaths() {
  const list = [...runtimeFiles.filter(file => fs.existsSync(path.join(source, file)))];
  for (const dir of runtimeDirs) list.push(...walk(path.join(source, dir), source));
  return list.sort();
}
function readManifest() {
  /* A fresh checkout has no manifest and no App/ to describe - this tool is
     for a workspace that keeps a built copy beside src/. Treat that as an
     empty manifest rather than an unhandled ENOENT: the caller then reports
     that there is nothing installed, which is the truth. */
  if (!fs.existsSync(manifestPath)) return [];
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return [...raw.matchAll(/^\s*"([^"]+)":\s*"([0-9a-f]{64})",?\s*$/gm)].map(match => [
    match[1],
    match[2]
  ]);
}
function writeManifest(entries) {
  const body = entries
    .map(([key, value]) => '  ' + JSON.stringify(key) + ': ' + JSON.stringify(value))
    .join(',\r\n');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, '{\r\n' + body + '\r\n}\r\n', 'utf8');
}

const changed = [],
  added = [],
  removed = [];
for (const relative of runtimePaths()) {
  const from = path.join(source, relative),
    to = path.join(installed, relative);
  if (!fs.existsSync(to)) {
    added.push(relative);
    continue;
  }
  if (hash(from) !== hash(to)) changed.push(relative);
}
/* Everything at the top of the installed copy as well as everything inside the
   directories - otherwise a file that MOVES out of the root is copied to its
   new home and left behind at its old one. That is what happened when the
   eleven main-process and library modules went into main/ and lib/: both
   copies existed, the manifest described both, --check called the tree clean,
   and only the stale one was what Electron would have loaded if package.json
   had not moved too. package.json is the deliberate exception, since
   package.js writes a trimmed version there on purpose. */
const installedTop = fs
  .readdirSync(installed, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name !== 'package.json')
  .map(entry => entry.name);
for (const relative of [
  ...new Set([
    ...runtimeFiles,
    ...installedTop,
    ...runtimeDirs.flatMap(dir => walk(path.join(installed, dir), installed))
  ])
])
  if (fs.existsSync(path.join(installed, relative)) && !fs.existsSync(path.join(source, relative)))
    removed.push(relative);

/* An entry whose file is not on disk is stale however it got there - including
   a file deleted from source AND installed before this ran, which the removal
   sweep above cannot see because there is nothing left to match. */
const stale = readManifest()
  .filter(([key]) => !fs.existsSync(path.join(root, 'App', key.split('/').join(path.sep))))
  .map(([key]) => key);
const report = [
  ['changed', changed],
  ['new in source', added],
  ['missing from source', removed],
  ['in the manifest but not on disk', stale]
];
for (const [label, list] of report) {
  if (!list.length) continue;
  console.log(label + ': ' + list.length);
  for (const item of list) console.log('  ' + item);
}
const nothingToDo = !changed.length && !added.length && !removed.length && !stale.length;
if (nothingToDo) console.log('Installed copy already matches src.');
if (check || nothingToDo) process.exit(0);

for (const relative of [...changed, ...added]) {
  const to = path.join(installed, relative);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(source, relative), to);
}
for (const relative of removed) fs.rmSync(path.join(installed, relative), { force: true });

const entries = readManifest();
const byKey = new Map(entries);
for (const relative of [...changed, ...added])
  byKey.set('resources/app/' + relative, hash(path.join(installed, relative)));
for (const relative of removed) byKey.delete('resources/app/' + relative);
for (const key of stale) byKey.delete(key);
const next = entries.filter(([key]) => byKey.has(key)).map(([key]) => [key, byKey.get(key)]);
const known = new Set(next.map(([key]) => key));
for (const [key, value] of byKey) if (!known.has(key)) next.push([key, value]);
writeManifest(next);

let mismatched = 0;
for (const [key, value] of next) {
  const file = path.join(root, 'App', key.split('/').join(path.sep));
  if (!fs.existsSync(file) || hash(file) !== value) mismatched++;
}
console.log(
  '\nSynced ' +
    (changed.length + added.length) +
    ' file(s), removed ' +
    removed.length +
    ', dropped ' +
    stale.length +
    ' stale manifest entr' +
    (stale.length === 1 ? 'y' : 'ies') +
    '.'
);
console.log('Manifest entries: ' + next.length + '. Mismatched after write: ' + mismatched + '.');
process.exit(mismatched ? 1 : 0);
