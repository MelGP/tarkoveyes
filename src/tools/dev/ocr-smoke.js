import fs from 'node:fs';
import path from 'node:path';
import { createWorker, OEM } from 'tesseract.js';
import language from '@tesseract.js-data/eng';
(async () => {
  const directory = process.argv[2],
    files = fs
      .readdirSync(directory)
      .filter(name => /\.(?:png|jpe?g|webp|bmp)$/i.test(name))
      .map(name => ({ name, time: fs.statSync(path.join(directory, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
  if (!files.length) throw Error('No image found');
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    langPath: language.langPath,
    workerPath: require.resolve('tesseract.js/src/worker-script/node/index.js'),
    corePath: path.dirname(require.resolve('tesseract.js-core/tesseract-core.wasm.js')),
    cachePath: path.join(import.meta.dirname, '../../.ocr-smoke-cache')
  });
  const result = await worker.recognize(path.join(directory, files[0].name));
  await worker.terminate();
  console.log(
    JSON.stringify({
      file: files[0].name,
      confidence: result.data.confidence,
      textLength: result.data.text.length
    })
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
