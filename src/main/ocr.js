/*
 * Local OCR: the Tesseract worker, and the two things the application asks it
 * to read - a Tasks screenshot, and the region around the cursor.
 *
 * Everything here runs in the main process and nothing leaves the machine.
 * The worker is created once and kept; ocrQueue serialises requests, because
 * one worker cannot read two images at a time.
 *
 * It imports from main.js and main.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later, from
 * an IPC handler or the item hotkey.
 */
/* Electron and node bindings, which the lifting tool does not carry: it only
   ever rewires local './x.js' imports, so a module it creates arrives using
   `fs` and `path` and importing neither. node --check cannot see that, and
   nor can any check that maps names to whoever exports them - these are not
   exported by anything. */
import { app, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { require, store, userData, validateMode, win } from './main.js';
import { loadCatalog, loadItemCatalog } from './catalogs.js';
import { parseTaskOcr } from '../lib/core.js';
import { matchItemText } from '../lib/items.js';

export let ocrWorker;

export let ocrWorkerPromise;

export let lastOcrProgress = '';

export let ocrContext = null;

export let ocrQueue = Promise.resolve();

export async function ensureOcrWorker() {
  if (!ocrWorkerPromise)
    ocrWorkerPromise = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      const language = (await import('@tesseract.js-data/eng')).default;
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        langPath: language.langPath,
        workerPath: require.resolve('tesseract.js/src/worker-script/node/index.js'),
        corePath: path.dirname(require.resolve('tesseract.js-core/tesseract-core.wasm.js')),
        cachePath: path.join(app.getPath('userData'), 'ocr-cache'),
        logger: progress => {
          const done = progress.progress || 0,
            step = progress.status + ':' + Math.floor(done * 10);
          if (step === lastOcrProgress || win?.isDestroyed()) return;
          lastOcrProgress = step;
          win.webContents.send('ocr-progress', {
            status: progress.status,
            progress: done,
            context: ocrContext
          });
        }
      });
      await worker.setParameters({ preserve_interword_spaces: '1' });
      ocrWorker = worker;
      return worker;
    })().catch(error => {
      ocrWorkerPromise = null;
      throw error;
    });
  return ocrWorkerPromise;
}

export function recognizeWithOcr(image, context) {
  const job = ocrQueue.then(async () => {
    const worker = await ensureOcrWorker();
    ocrContext = context;
    try {
      await worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: context === 'hotkey' ? '11' : '3'
      });
      return await worker.recognize(image, {}, { blocks: true, text: true });
    } finally {
      ocrContext = null;
    }
  });
  ocrQueue = job.catch(() => {});
  return job;
}

export async function pickScreenshot(title) {
  const picked = await dialog.showOpenDialog(win, {
    title,
    properties: ['openFile'],
    filters: [{ name: 'Screenshot image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
  });
  if (picked.canceled) return null;
  const file = await fs.promises.realpath(picked.filePaths[0]),
    stat = await fs.promises.stat(file);
  if (!stat.isFile() || stat.size > 30 * 1024 * 1024)
    throw Error('Choose a screenshot smaller than 30 MB.');
  return file;
}

export async function recognizeTasks(mode) {
  validateMode(mode);
  const file = await pickScreenshot('Scan Tarkov Tasks screenshot');
  if (!file) return null;
  const result = await recognizeWithOcr(file, 'tasks'),
    catalog = loadCatalog(mode),
    activeIds = Object.entries(store.data.profiles[mode].quests)
      .filter(([, value]) => value === 'active')
      .map(([id]) => id);
  return {
    file: path.basename(file),
    confidence: Math.round(result.data.confidence || 0),
    matches: parseTaskOcr(result.data.text, catalog.quests, activeIds),
    textPreview: String(result.data.text || '').slice(0, 12000)
  };
}

export async function recognizeItem(mode) {
  validateMode(mode);
  const file = await pickScreenshot('Scan Tarkov item screenshot');
  if (!file) return null;
  const result = await recognizeWithOcr(file, 'item'),
    catalog = loadItemCatalog(mode);
  return {
    file: path.basename(file),
    confidence: Math.round(result.data.confidence || 0),
    matches: matchItemText(result.data.text, catalog),
    textPreview: String(result.data.text || '').slice(0, 8000),
    catalog: {
      generatedAt: catalog.generatedAt,
      pricesUpdatedAt: catalog.pricesUpdatedAt,
      source: catalog.source,
      count: catalog.items.length
    }
  };
}
