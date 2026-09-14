/*
 * items-view, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import {
  assignItemCatalog,
  assignItemHotkeyState,
  assignItemScanRunning,
  assignLastItemResults,
  assignLastItemResultsScanned,
  bridge,
  data,
  itemCatalog,
  itemHotkeyState
} from './state.js';
import { price } from './app.js';
import { $, el, toast, uiIcon } from './dom.js';

export function itemModeName() {
  return data.mode === 'seasonal' ? 'Seasonal · Kord Breach' : data.mode.toUpperCase();
}

export function itemCatalogStatus() {
  if (!itemCatalog) return;
  $('items-profile').textContent = itemModeName() + ' prices';
  const date = itemCatalog.pricesUpdatedAt || itemCatalog.generatedAt,
    when = date ? new Date(date).toLocaleString() : 'unknown time';
  $('item-catalog-status').textContent =
    new Intl.NumberFormat('en-US').format(itemCatalog.items.length) +
    ' items · prices checked ' +
    when +
    ' · ' +
    itemCatalog.source;
}

export function updateItemHotkey(state) {
  assignItemHotkeyState({ ...itemHotkeyState, ...state });
  data.settings.itemHotkeyEnabled = itemHotkeyState.enabled;
  const checkbox = $('item-hotkey-enabled'),
    row = checkbox.closest('.item-hotkey');
  checkbox.checked = itemHotkeyState.enabled;
  row.classList.toggle('disabled', !itemHotkeyState.enabled || !itemHotkeyState.registered);
  $('item-hotkey-status').textContent = !itemHotkeyState.enabled
    ? 'Shortcut off'
    : itemHotkeyState.registered
      ? 'Ready · hover an inventory item, then press Shift+F8'
      : 'Shift+F8 is already used by another app';
}

export function renderItemResults(items, { scanned = false } = {}) {
  assignLastItemResults(items);
  assignLastItemResultsScanned(scanned);
  const root = $('item-results');
  root.replaceChildren();
  if (!items.length) {
    const empty = el('div', 'item-empty');
    empty.append(
      uiIcon('search'),
      el('strong', '', scanned ? 'No reliable item match' : 'No matching items'),
      el(
        'p',
        '',
        scanned
          ? 'Keep the cursor on the inventory tile and try Shift+F8 again.'
          : 'Try the full item name or its in-game short name.'
      )
    );
    root.append(empty);
    return;
  }
  for (const item of items) {
    const noFlea = item.types?.includes('noFlea'),
      flea =
        !noFlea && item.avg24hPrice > 0
          ? item.avg24hPrice
          : !noFlea && item.lastLowPrice > 0
            ? item.lastLowPrice
            : null,
      trader = item.bestTrader?.price > 0 ? item.bestTrader.price : null,
      best = Math.max(flea || 0, trader || 0),
      slots = Math.max(1, (item.width || 1) * (item.height || 1)),
      perSlot = best ? Math.round(best / slots) : 0,
      threshold = Number(data.settings.itemValueThreshold) || 0,
      grade =
        threshold && perSlot >= threshold
          ? 'great'
          : threshold && perSlot >= threshold * 0.6
            ? 'good'
            : '',
      card = el('article', 'item-card' + (grade ? ' loot-' + grade : '')),
      head = el('div', 'item-card-head'),
      glyph = el('span', 'item-glyph', (item.shortName || item.name).slice(0, 3).toUpperCase()),
      title = el('div', 'item-title');
    title.append(
      el('strong', '', item.name),
      el(
        'small',
        '',
        (item.shortName || '') +
          ' · ' +
          slots +
          ' slot' +
          (slots === 1 ? '' : 's') +
          (item.category ? ' · ' + item.category : '')
      )
    );
    head.append(glyph, title);
    if (scanned)
      head.append(el('span', 'match-badge', Math.round((item.confidence || 0) * 100) + '% match'));
    if (grade === 'great') head.append(el('span', 'loot-badge', 'TAKE'));
    card.append(head);
    const values = el('div', 'item-values'),
      fleaBox = el('div', 'price-box');
    fleaBox.append(
      el('span', '', 'FLEA 24H'),
      el('strong', '', price(flea)),
      el(
        'small',
        '',
        noFlea
          ? 'Not flea marketable'
          : item.low24hPrice > 0
            ? 'Low ' + price(item.low24hPrice)
            : 'No recent low'
      )
    );
    const traderBox = el('div', 'price-box');
    traderBox.append(
      el('span', '', 'BEST TRADER'),
      el('strong', '', price(trader)),
      el('small', '', item.bestTrader?.trader || 'No trader price')
    );
    const slotBox = el('div', 'price-box best-value');
    slotBox.append(
      el('span', '', 'BEST / SLOT'),
      el('strong', '', price(perSlot || null)),
      el(
        'small',
        '',
        best
          ? flea !== null && flea >= trader
            ? 'Sell on flea'
            : 'Sell to ' + item.bestTrader.trader
          : 'No market price'
      )
    );
    values.append(fleaBox, traderBox, slotBox);
    card.append(values);
    const foot = el('div', 'item-card-foot'),
      change = Number.isFinite(item.changeLast48hPercent) ? item.changeLast48hPercent : null;
    foot.append(
      el(
        'span',
        change > 0 ? 'price-up' : change < 0 ? 'price-down' : '',
        change === null
          ? '48h change unavailable'
          : (change > 0 ? '+' : '') + change.toFixed(1) + '% in 48h'
      ),
      el(
        'span',
        '',
        item.minLevelForFlea ? 'Flea level ' + item.minLevelForFlea : 'Flea restriction unknown'
      )
    );
    card.append(foot);
    root.append(card);
  }
}

export function searchItems() {
  if (!itemCatalog) return;
  const query = $('item-search')
    .value.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!query) {
    const root = $('item-results'),
      empty = el('div', 'item-empty');
    empty.append(
      uiIcon('crosshair'),
      el('strong', '', 'Hover an inventory item and press Shift+F8'),
      el(
        'p',
        '',
        'No Inspect needed. Keep the cursor on its tile while TarkovEyes reads the label around it.'
      )
    );
    root.replaceChildren(empty);
    return;
  }
  const words = query.split(' '),
    ranked = itemCatalog.items
      .map(item => {
        const name = (item.name + ' ' + item.shortName).toLowerCase(),
          score =
            (name.startsWith(query) ? 5 : 0) +
            (name.includes(query) ? 3 : 0) +
            words.filter(word => name.includes(word)).length / words.length;
        return { item, score };
      })
      .filter(row => row.score >= 1)
      .sort((a, b) => b.score - a.score || (b.item.avg24hPrice || 0) - (a.item.avg24hPrice || 0))
      .slice(0, 30)
      .map(row => row.item);
  renderItemResults(ranked);
}

export async function loadItemsView() {
  $('items-profile').textContent = itemModeName() + ' prices';
  $('item-value-threshold').value = data.settings.itemValueThreshold;
  $('item-catalog-status').textContent = 'Loading local price catalog…';
  try {
    assignItemCatalog(
      bridge.loadItems
        ? await bridge.loadItems(data.mode)
        : await (await fetch('data/items-' + data.mode + '.json')).json()
    );
    itemCatalogStatus();
    searchItems();
  } catch (e) {
    assignItemCatalog(null);
    $('item-catalog-status').textContent = 'Could not load the local price catalog.';
    renderItemResults([]);
  }
}

export async function openItems() {
  if (!$('items-dialog').open) $('items-dialog').showModal();
  await loadItemsView();
}

export async function runItemScan() {
  if (!window.companion) {
    toast('Item screenshot scanning is available in the Windows app.');
    return;
  }
  const button = $('scan-item'),
    label = button.querySelector('span');
  button.disabled = true;
  label.textContent = 'Reading…';
  assignItemScanRunning(true);
  $('item-ocr-preview').textContent = 'Reading the screenshot locally…';
  try {
    const result = await bridge.scanItem(data.mode);
    if (!result) return;
    $('item-ocr-preview').textContent = result.textPreview || 'No text recognized.';
    renderItemResults(result.matches || [], { scanned: true });
    if (result.catalog) itemCatalogStatus();
    toast(
      (result.matches || []).length
        ? 'Item matches ready. Compare before selling.'
        : 'No reliable item name found.'
    );
  } catch (e) {
    renderItemResults([], { scanned: true });
    toast(
      'Item scan failed: ' + e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    );
  } finally {
    assignItemScanRunning(false);
    button.disabled = false;
    label.textContent = 'Scan screenshot';
  }
}

export async function refreshItemPrices() {
  if (!window.companion) {
    toast('Price updates are available in the Windows app.');
    return;
  }
  const button = $('refresh-prices'),
    label = button.querySelector('span');
  button.disabled = true;
  label.textContent = 'Updating…';
  $('item-catalog-status').textContent =
    'Downloading the latest ' + itemModeName() + ' prices from tarkov.dev…';
  try {
    assignItemCatalog(await bridge.refreshItemPrices(data.mode));
    itemCatalogStatus();
    searchItems();
    toast('Item prices updated.');
  } catch (e) {
    itemCatalogStatus();
    toast(
      'Could not update prices: ' +
        e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    );
  } finally {
    button.disabled = false;
    label.textContent = 'Update prices';
  }
}
