#!/usr/bin/env node
/*
 * Build app/assets/TarkovEyes.ico from app/assets/logo.png.
 *
 * No image library is involved: the running application's renderer resamples
 * the emblem to each size and hands back raw pixels, and everything below
 * writes the container by hand. The application has to be up on
 * --remote-debugging-port=9222, the same way tools/dev/renderer-smoke.js is driven,
 * and for the same reason tools/build/build-appearance.cjs runs under Electron - that
 * is where the image decoder lives in this project.
 *
 * ## The format, and the version of this that looked fine and was not
 *
 * An .ico is a six-byte header, a sixteen-byte record per size, then the
 * images. Since Vista an image may be a PNG, so the first version of this tool
 * wrote PNGs at every size - much less code, and `new System.Drawing.Icon(file,
 * 32, 32)` loaded it and reported 32x32, which looked like proof.
 *
 * It was not. Drawing those icons produced pure colour noise: GDI+ read the PNG
 * bytes as raw DIB pixels. Explorer copes with PNG entries; a great deal else
 * does not.
 *
 * So every size up to 128 is a **DIB** - a BITMAPINFOHEADER whose height is
 * doubled to cover the XOR image and the AND mask, 32-bit BGRA, bottom-up - and
 * only 256 is a PNG, which is the convention every icon toolchain follows.
 *
 * Usage:
 *   1. start App\RaidNotes.exe --remote-debugging-port=9222
 *   2. node tools/build/build-icon.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const target = path.join(root, 'app', 'assets', 'TarkovEyes.ico');
const port = Number(process.env.TARKOVEYES_DEBUG_PORT || 9222);
const dibSizes = [16, 24, 32, 48, 64, 128];
const pngSize = 256;

/* The renderer-side half: resample, then return raw RGBA for the DIB sizes and
   a PNG for 256. */
const script = `(async () => {
  const src = await new Promise((ok, bad) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => bad(Error('logo.png did not load'));
    img.src = 'assets/logo.png?' + Date.now();
  });
  const draw = size => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    /* Halve down to 2x the target before the last draw. One direct draw from
       1254 to 16 throws most of the pixels away and comes out muddy. */
    let from = src, w = src.naturalWidth;
    while (w > size * 2) {
      const half = document.createElement('canvas');
      half.width = half.height = Math.round(w / 2);
      const hg = half.getContext('2d');
      hg.imageSmoothingQuality = 'high';
      hg.drawImage(from, 0, 0, half.width, half.height);
      from = half;
      w = half.width;
    }
    g.drawImage(from, 0, 0, size, size);
    return { canvas: c, ctx: g };
  };
  const rgba = {};
  for (const size of ${JSON.stringify(dibSizes)}) {
    const { ctx } = draw(size);
    const data = ctx.getImageData(0, 0, size, size).data;
    let s = '';
    for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
    rgba[size] = btoa(s);
  }
  const big = draw(${pngSize});
  return JSON.stringify({
    natural: src.naturalWidth,
    rgba,
    png: big.canvas.toDataURL('image/png')
  });
})()`;

async function renderSizes() {
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const page = list.find(t => t.type === 'page');
  if (!page) throw Error('no page on the debug port');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, bad) => {
    ws.onopen = ok;
    ws.onerror = () => bad(Error('could not open the debug socket'));
  });
  const result = await new Promise((ok, bad) => {
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.id !== 1) return;
      if (msg.error) return bad(Error(msg.error.message));
      if (msg.result?.exceptionDetails)
        return bad(Error(msg.result.exceptionDetails.exception?.description || 'page threw'));
      ok(msg.result.result.value);
    };
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: script, awaitPromise: true, returnByValue: true }
      })
    );
  });
  ws.close();
  return JSON.parse(result);
}

/* Canvas gives RGBA top-down; a DIB wants BGRA bottom-up, followed by an AND
   mask. The mask is all zeros - every pixel is "not transparent" as far as the
   1-bit mask is concerned, and the real transparency comes from the alpha
   channel - but it has to be there, and its rows are padded to four bytes. */
function dib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight: XOR image plus AND mask
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression: BI_RGB

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const source = y * size * 4,
      dest = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      const s = source + x * 4,
        d = dest + x * 4;
      xor[d] = rgba[s + 2]; // B
      xor[d + 1] = rgba[s + 1]; // G
      xor[d + 2] = rgba[s]; // R
      xor[d + 3] = rgba[s + 3]; // A
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskRow * size);
  header.writeUInt32LE(xor.length + and.length, 20); // biSizeImage
  return Buffer.concat([header, xor, and]);
}

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, body } of images) {
    const e = Buffer.alloc(16);
    /* 256 is written as 0: the field is one byte and 256 does not fit in it. */
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette entries: 0 for truecolour
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(body.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += body.length;
  }
  return Buffer.concat([header, ...entries, ...images.map(i => i.body)]);
}

(async () => {
  const rendered = await renderSizes();
  const images = dibSizes.map(size => ({
    size,
    kind: 'dib',
    body: dib(size, Buffer.from(rendered.rgba[size], 'base64'))
  }));
  images.push({
    size: pngSize,
    kind: 'png',
    body: Buffer.from(rendered.png.split(',')[1], 'base64')
  });

  const ico = buildIco(images);
  fs.writeFileSync(target, ico);
  console.log('source ' + rendered.natural + 'px');
  for (const i of images)
    console.log(
      '  ' + String(i.size).padStart(3) + 'px  ' + i.kind + '  ' + i.body.length + ' bytes'
    );
  console.log(
    '\nwrote ' + path.relative(root, target) + '  (' + Math.round(ico.length / 1024) + ' KB)'
  );
})().catch(error => {
  console.error(error.message);
  console.error('\nStart the app with --remote-debugging-port=9222 first.');
  process.exit(1);
});
