import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(import.meta.dirname, '../..'),
  runtime = path.join(root, 'node_modules/electron/dist'),
  out = path.join(root, 'dist/TarkovEyes-win32-x64');
if (!fs.existsSync(path.join(runtime, 'electron.exe')))
  throw Error('Install Electron before packaging');
const outRelative = path.relative(root, out);
if (!outRelative || outRelative.startsWith('..') || path.isAbsolute(outRelative))
  throw Error('Invalid package output path');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const entry of fs.readdirSync(runtime)) {
  const dest = entry === 'electron.exe' ? 'TarkovEyes.exe' : entry;
  fs.cpSync(path.join(runtime, entry), path.join(out, dest), { recursive: true });
}
const app = path.join(out, 'resources/app');
fs.mkdirSync(app, { recursive: true });
for (const item of ['app', 'lib', 'main', 'licenses', 'LICENSE', 'THIRD-PARTY.md'])
  fs.cpSync(path.join(root, item), path.join(app, item), { recursive: true });
const manifest = JSON.parse(
  fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
);
const lock = JSON.parse(
  fs.readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')
);
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
      /* Without this the installed copy reads main.js as CommonJS and dies
         on the first import. The source says type: module; so must the
         trimmed copy. */
      type: manifest.type,
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
  console.warn('No app/assets/TarkovEyes.ico - run tools/build/build-icon.js first.');
} else {
  let rcedit = null;
  let wrongShape = '';
  try {
    /* This was `require('rcedit')` before the ES module conversion, which
       returned the function directly. The branch only runs when rcedit is
       installed, so nothing exercised it, and the packager died with "rcedit
       is not a function" the first time someone did install it.
       rcedit 5 exports a NAMED `rcedit`, not a default, so all three shapes
       are accepted rather than guessing which one this version uses. */
    const loaded = await import('rcedit');
    rcedit = typeof loaded === 'function' ? loaded : (loaded.default ?? loaded.rcedit);
    if (typeof rcedit !== 'function') {
      wrongShape =
        'rcedit is installed but exports nothing callable (' +
        Object.keys(loaded).join(', ') +
        '), so TarkovEyes.exe keeps Electron’s icon.';
      rcedit = null;
    }
  } catch {
    /* not installed, which is the normal case here */
  }
  if (wrongShape) {
    /* Reported rather than folded into "not installed". Silently treating a
       shape mismatch as an absent package is how the previous version hid
       its own bug. */
    console.warn(wrongShape);
  } else if (typeof rcedit === 'function') {
    /* Awaited, because the SHA-256 inventory below hashes this exe. As a
       floating promise it recorded the bytes from before the icon was
       stamped, so the shipped manifest described a file that no longer
       existed. */
    try {
      await rcedit(path.join(out, 'TarkovEyes.exe'), { icon });
      console.log('Stamped the icon into TarkovEyes.exe');
    } catch (error) {
      console.warn('Could not stamp the icon: ' + error.message);
    }
  } else {
    console.warn(
      "rcedit is not installed, so TarkovEyes.exe keeps Electron's icon.\n" +
        '  npm i -D rcedit   then re-run, or stamp it by hand:\n' +
        '  npx rcedit "' +
        path.join(out, 'TarkovEyes.exe') +
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
    JSON.parse(
      fs.readFileSync(new URL('../../node_modules/electron/package.json', import.meta.url), 'utf8')
    ).version +
    ' at ' +
    out
);
console.log(Object.keys(hashes).length + ' files recorded in dist/SHA256.json');
