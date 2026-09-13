/*
 * Sends a REAL key press to the running application, and reports what changed.
 *
 * This exists because a dispatched `new KeyboardEvent('keydown', ...)` is not a
 * key press. It runs the page's own listeners, which is enough to test a
 * shortcut the renderer implements, but it does not drive anything the browser
 * itself does - most importantly it does not close a <dialog>. A check written
 * with a synthetic event therefore reports that Escape does not close a dialog
 * whether it does or not, and that false negative has cost time here before.
 * `Input.dispatchKeyEvent` is the only honest way to ask.
 *
 * Start the application with --remote-debugging-port=9222 first, then:
 *
 *   node tools/dev/press-key.cjs setup.js Escape check.js
 *
 * `setup.js` and `check.js` each hold ONE expression, evaluated in the page.
 * Pass `-` for setup to press the key against whatever is on screen. The value
 * `check.js` evaluates to is printed as JSON. Both may be async.
 *
 * Keys: Escape, Enter, ArrowDown, ArrowUp. Add to KEYS as needed - the code
 * and the virtual key code both have to be right or the page sees nothing.
 */
const http = require('node:http');
const fs = require('node:fs');

function targets(port) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: '/json/list' }, response => {
        let body = '';
        response.on('data', chunk => (body += chunk));
        response.on('end', () => resolve(JSON.parse(body)));
      })
      .on('error', reject);
  });
}

const KEYS = {
  Escape: { windowsVirtualKeyCode: 27, code: 'Escape', key: 'Escape' },
  Enter: { windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter' },
  ArrowDown: { windowsVirtualKeyCode: 40, code: 'ArrowDown', key: 'ArrowDown' },
  ArrowUp: { windowsVirtualKeyCode: 38, code: 'ArrowUp', key: 'ArrowUp' }
};

async function main() {
  const [setupFile, keyName, checkFile] = process.argv.slice(2);
  const spec = KEYS[keyName];
  if (!spec) throw Error('unknown key: ' + keyName);

  const page = (await targets(9222)).find(t => t.type === 'page' && !/price-overlay/.test(t.url));
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const send = (method, params) =>
    new Promise(resolve => {
      const mine = ++id;
      const listen = raw => {
        const message = JSON.parse(raw.data);
        if (message.id !== mine) return;
        socket.removeEventListener('message', listen);
        resolve(message.result);
      };
      socket.addEventListener('message', listen);
      socket.send(JSON.stringify({ id: mine, method, params }));
    });

  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (r?.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || 'threw');
    return r?.result?.value;
  };

  if (setupFile && setupFile !== '-') await evaluate(fs.readFileSync(setupFile, 'utf8'));
  await new Promise(r => setTimeout(r, 400));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...spec });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...spec });
  await new Promise(r => setTimeout(r, 600));
  const result = await evaluate(fs.readFileSync(checkFile, 'utf8'));
  console.log(JSON.stringify(result, null, 1));
  process.exit(0);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
