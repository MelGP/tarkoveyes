/*
 * Where the bundled assets are, and nothing else.
 *
 * This file exists because of a real failure rather than for tidiness. The
 * main process is a cycle - main.js imports catalogs.js, item-hotkey.js and
 * ocr.js, and all three import back - and that is safe only while the borrowed
 * names are used when something is CALLED. catalogs.js breaks that rule by
 * construction: it reads the quest catalogues into `const`s at the top of the
 * file, so it needs assetRoot the moment it evaluates, and it evaluates before
 * main.js because main.js is what imports it. The application died on launch
 * with "Cannot access 'assetRoot' before initialization" - a temporal dead
 * zone, not a missing export, so nothing static could have predicted it.
 *
 * A leaf with no imports of its own cannot take part in a cycle, so anything
 * needed while a module is still evaluating belongs here.
 */
import path from 'node:path';

export const assetRoot = path.join(import.meta.dirname, '..', 'app');
