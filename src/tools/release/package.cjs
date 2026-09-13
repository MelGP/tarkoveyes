const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..'),
  runtime = path.join(root, 'node_modules/electron/dist'),
  out = path.join(root, 'dist/RaidNotes-win32-x64');
if (!fs.existsSync(path.join(runtime, 'electron.exe')))
  throw Error('Install Electron before packaging');
const outRelative = path.relative(root, out);
if (!outRelative || outRelative.startsWith('..') || path.isAbsolute(outRelative))
  throw Error('Invalid package output path');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const entry of fs.readdirSync(runtime)) {
  const dest = entry === 'electron.exe' ? 'RaidNotes.exe' : entry;
  fs.cpSync(path.join(runtime, entry), path.join(out, dest), { recursive: true });
}
const app = path.join(out, 'resources/app');
fs.mkdirSync(app, { recursive: true });
for (const item of [
  'app',
  'main.cjs',
  'preload.cjs',
  'core.cjs',
  'items.cjs',
  'imaging.cjs',
  'appearance.cjs',
  'templates.cjs',
  'licenses',
  'LICENSE',
  'THIRD-PARTY.md'
])
  fs.cpSync(path.join(root, item), path.join(app, item), { recursive: true });
const manifest = require('../../package.json'),
  lock = require('../../package-lock.json');
for (const [relative, metadata] of Object.entries(lock.packages || {})) {
  if (!relative.startsWith('node_modules/') || metadata.dev) continue;
  const source = path.join(root, relative),
    destination = path.join(app, relative);
  if (fs.existsSync(source)) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
  }
}
fs.writeFileSync(
  path.join(app, 'package.json'),
  JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      main: manifest.main,
      description: manifest.description,
      dependencies: manifest.dependencies
    },
    null,
    2
  )
);
/* The icon in the exe.
 *
 * This packager is hand-rolled: it copies Electron's dist and renames
 * electron.exe, so without this step the release wears Electron's own icon.
 * Changing it means rewriting the binary's Windows resource section, which
 * needs a resource editor - rcedit is the usual one, and it is not a
 * dependency of this project.
 *
 * So: use it when it is there, and when it is not, say exactly what did not
 * happen. A packager that silently ships the wrong icon is worse than one
 * that tells you it could not change it.
 */
const icon = path.join(root, 'app/assets/TarkovEyes.ico');
if (!fs.existsSync(icon)) {
  console.warn('No app/assets/TarkovEyes.ico - run tools/build/build-icon.cjs first.');
} else {
  let rcedit = null;
  try {
    rcedit = require('rcedit');
  } catch {
    /* not installed, which is the normal case here */
  }
  if (rcedit) {
    rcedit(path.join(out, 'RaidNotes.exe'), { icon }).then(
      () => console.log('Stamped the icon into RaidNotes.exe'),
      error => console.warn('Could not stamp the icon: ' + error.message)
    );
  } else {
    console.warn(
      "rcedit is not installed, so RaidNotes.exe keeps Electron's icon.\n" +
        '  npm i -D rcedit   then re-run, or stamp it by hand:\n' +
        '  npx rcedit "' +
        path.join(out, 'RaidNotes.exe') +
        '" --set-icon "' +
        icon +
        '"'
    );
  }
}
const hashes = {};
function inventory(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name),
      relative = path.relative(out, p).replaceAll('\\', '/');
    if (entry.isDirectory()) inventory(p);
    else if (relative !== 'debug.log')
      hashes[relative] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
}
inventory(out);
fs.writeFileSync(path.join(root, 'dist/SHA256.json'), JSON.stringify(hashes, null, 2));
console.log(
  'Packaged ' +
    manifest.version +
    ' with Electron ' +
    require('electron/package.json').version +
    ' at ' +
    out
);
console.log(Object.keys(hashes).length + ' files recorded in dist/SHA256.json');
