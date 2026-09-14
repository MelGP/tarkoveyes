/*
 * dom, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { assignToastTimer, toastTimer } from './state.js';
import { svgNS } from './app.js';

export const $ = id => document.getElementById(id);

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function svg(tag, attrs = {}) {
  const n = document.createElementNS(svgNS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
}

export function uiIcon(name) {
  const n = svg('svg', { class: 'icon', 'aria-hidden': 'true' });
  n.append(svg('use', { href: 'assets/icons.svg#' + name }));
  return n;
}

/* A toast reports either 'done' or 'that did not work', and both wore the same
 * amber. Losing progress is the worst thing this application can report, so a
 * failure gets its own tone, interrupts rather than waits its turn, and stays
 * up long enough to read a sentence about disk space. */
export function toast(message, tone) {
  const el = $('toast');
  const failed = tone === 'error';
  el.classList.toggle('toast-error', failed);
  el.setAttribute('role', failed ? 'alert' : 'status');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  assignToastTimer(setTimeout(() => (el.hidden = true), failed ? 7000 : 4500));
}
