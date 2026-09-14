/*
 * quest-brief, lifted out of app.js.
 *
 * It imports from app.js and app.js imports back. The cycle is safe because
 * nothing is used while the modules evaluate - all of it is called later,
 * from a render or an event handler.
 */
import { objectiveVerb, verbLabels } from './vocabulary.js';
import { collectorPath } from './quest-routes.js';

import { renderList } from './quest-list.js';
import { keyIconFor } from './keys.js';
import { renderChain } from './chain.js';
import { $, el, svg, toast } from './dom.js';
import {
  availableBecause,
  isDone,
  mapName,
  mappedElsewhere,
  objectivePoints,
  objectiveProgress,
  openQuestOnMap,
  profile,
  questKeyList,
  questMaps,
  requirementId,
  source,
  status,
  unlockedBy,
  unlockedByNames
} from './quest-state.js';
import { renderMarkers, verbGlyph } from './markers.js';
import { focusQuest } from './view.js';
import {
  allData,
  bridge,
  currentMapId,
  data,
  detailsCollapsed,
  mapFocus,
  myRaidOpen,
  questImages,
  questWiki,
  quests,
  selected,
  traderCatalog
} from './state.js';
import { changeProgress, railLayout, selectQuest } from './app.js';

export let briefAlignFrame = 0;

export function alignBrief() {
  briefAlignFrame = 0;
  const main = document.querySelector('main');
  const brief = $('details');
  if (!main || !brief) return;
  const off = !railLayout.matches || detailsCollapsed || mapFocus;
  if (off) {
    main.style.removeProperty('--brief-top');
    main.style.removeProperty('--notch-y');
    main.classList.remove('brief-tied');
    return;
  }
  const stage = main.getBoundingClientRect();
  const inset = 12;
  const height = brief.offsetHeight;
  const lowest = Math.max(inset, stage.height - inset - height);
  const row =
    $('quest-list').querySelector('.quest-row.selected') || (myRaidOpen ? $('show-active') : null);
  let top = inset;
  let tied = false;
  if (row) {
    const box = row.getBoundingClientRect();
    /* A row scrolled out of the list has no position worth pointing at, so the
       card stays where it is and the notch goes away rather than aiming at
       something off screen. */
    if (box.bottom > stage.top + 4 && box.top < stage.bottom - 4) {
      /* What should land level with the row is the first objective, not the
         top of the card. Above it sit the picture, the trader, the title, the
         map chips and BRING TO RAID - around 540px on a typical quest - and
         aligning the card's top instead leaves the objectives most of a
         screen below the row you clicked, which is the whole thing this
         layout exists to fix. */
      /* A quest brief leads with its objectives, so that is what should land
         level with the row. My Raid has none - it leads with its summary, at
         the very top of the card - and reaching for the first `.detail-section`
         instead aimed at BRING TO RAID, several hundred pixels down, which
         clamped the card to the top of the window and left the notch pointing
         a long way back up at the button. No objectives means no lead. */
      const target = brief.querySelector('.objective');
      const lead = target
        ? target.getBoundingClientRect().top - brief.getBoundingClientRect().top + brief.scrollTop
        : 0;
      top = Math.min(Math.max(box.top - stage.top - lead, inset), lowest);
      tied = true;
      const notch = Math.round(box.top - stage.top + box.height / 2 - top);
      main.style.setProperty('--notch-y', Math.min(Math.max(notch, 12), height - 12) + 'px');
      if (notch < 8 || notch > height - 8) tied = false;
    }
  }
  main.style.setProperty('--brief-top', Math.round(top) + 'px');
  main.classList.toggle('brief-tied', tied);
}

/* The brief is a floating card now, so it needs to introduce itself: a
 * landmark with a name, rather than an unlabelled aside that a screen reader
 * announces as nothing in particular. Set from whatever the card is currently
 * showing - a quest, or My Raid. */

/* The brief is a floating card now, so it needs to introduce itself: a
 * landmark with a name, rather than an unlabelled aside that a screen reader
 * announces as nothing in particular. Set from whatever the card is currently
 * showing - a quest, or My Raid. */
export function describeBrief(label) {
  const brief = $('details');
  if (!brief) return;
  brief.setAttribute('role', 'region');
  brief.setAttribute('aria-label', label);
}

export function scheduleBriefAlign() {
  if (briefAlignFrame) return;
  briefAlignFrame = requestAnimationFrame(alignBrief);
}

/* "logs synced" says the connection works; it does not say whether it has
 * looked recently, which is the thing you want to know after a raid. The
 * footer line that carried the timestamp is hidden in the rail - showing it
 * costs a quest row - so the freshness goes where you already look for the
 * connection, at no extra height. A time alone would be a lie a day later,
 * so anything older than today says the date instead. */

export function renderDetail() {
  if (!selected) return;
  const q = selected,
    panel = $('details');
  panel.replaceChildren();
  const head = el('div', 'detail-head'),
    titleRow = el('div', 'detail-title-row');
  titleRow.append(el('h2', '', q.name));
  const favorite = el(
    'button',
    'favorite-button',
    (profile().favorites || []).includes(q.id) ? '★' : '☆'
  );
  favorite.title = 'Favorite quest';
  favorite.setAttribute('aria-label', 'Favorite ' + q.name);
  favorite.onclick = async () => {
    const favorites = new Set(profile().favorites || []);
    favorites.has(q.id) ? favorites.delete(q.id) : favorites.add(q.id);
    profile().favorites = [...favorites];
    await bridge.questMeta({ mode: data.mode, id: q.id, favorite: favorites.has(q.id) });
    renderDetail();
    renderList();
  };
  titleRow.append(favorite);
  /* Five hundred quests and you will never do all of them. Hiding one takes it
     out of every list and off the map; the Hidden status filter is how it comes
     back, so nothing is ever lost behind this button. */
  const isHidden = (profile().hiddenQuests || []).includes(q.id);
  const hideButton = el('button', 'favorite-button hide-button', isHidden ? '◉' : '◌');
  hideButton.title = isHidden ? 'Show this quest again' : 'Hide this quest from lists and the map';
  hideButton.setAttribute('aria-label', (isHidden ? 'Show ' : 'Hide ') + q.name);
  hideButton.setAttribute('aria-pressed', String(isHidden));
  hideButton.onclick = async () => {
    const hiddenQuests = new Set(profile().hiddenQuests || []);
    isHidden ? hiddenQuests.delete(q.id) : hiddenQuests.add(q.id);
    profile().hiddenQuests = [...hiddenQuests];
    try {
      await bridge.questMeta({ mode: data.mode, id: q.id, hidden: !isHidden });
    } catch {
      toast('Could not save that.', 'error');
    }
    renderDetail();
    renderList();
    renderMarkers();
    toast(
      isHidden
        ? q.name + ' is back in your lists.'
        : q.name + ' hidden. Find it again with the Hidden filter.'
    );
  };
  titleRow.append(hideButton);
  const questPicture = questImages[q.id];
  if (questPicture) {
    const hero = el('img', 'brief-hero');
    hero.src = questPicture;
    hero.alt = '';
    hero.loading = 'lazy';
    hero.onerror = () => hero.remove();
    head.append(hero);
  }
  const briefTrader = el('div', 'brief-trader');
  const briefPortrait = traderCatalog[q.traderId];
  if (briefPortrait) {
    const image = el('img', 'brief-trader-portrait');
    image.src = briefPortrait.image;
    image.alt = '';
    image.onerror = () => image.remove();
    briefTrader.append(image);
  }
  briefTrader.append(el('span', 'eyebrow', q.traderName.toUpperCase() + ' / QUEST BRIEF'));
  head.append(briefTrader, titleRow);
  const meta = el('div', 'detail-meta');
  meta.append(el('span', 'pill', questMaps(q)), el('span', 'pill', data.mode.toUpperCase()));
  if (q.minPlayerLevel > 0) meta.append(el('span', 'pill', 'Level ' + q.minPlayerLevel));
  if (source(q) === 'logs') meta.append(el('span', 'pill log-source', 'Updated from logs'));
  /* The renderer cannot follow a link - navigation is denied and the CSP is
     default-src 'self' - so the page opens in the real browser through a
     handler that accepts nothing but a fandom wiki path. 523 of the 541
     bundled quests have a page; the event quests Ref hands out do not, and
     those get no button rather than a guessed URL that lands on a 404. */
  const wikiPage = questWiki[q.id];
  if (wikiPage) {
    const wiki = el('button', 'pill wiki-link', 'Wiki ↗');
    wiki.title = 'Open the wiki page for ' + q.name + ' in your browser';
    wiki.onclick = () =>
      Promise.resolve(bridge.openWiki(wikiPage)).catch(() =>
        toast('Could not open the wiki page.', 'error')
      );
    meta.append(wiki);
  }
  head.append(meta);
  const mapPoints = objectivePoints(q),
    currentName = mapName(currentMapId),
    elsewhere = mapPoints.length ? null : mappedElsewhere(q.objectives);
  const focus = el(
    'button',
    'primary',
    mapPoints.length
      ? 'Show objectives on ' + currentName + ' ↗'
      : elsewhere
        ? 'Open on ' + mapName(elsewhere.id) + ' ↗'
        : 'No fixed map point'
  );
  focus.disabled = !mapPoints.length && !elsewhere;
  if (elsewhere)
    focus.title = 'Switch the tactical map to ' + mapName(elsewhere.id) + ' and show this quest';
  focus.onclick = elsewhere ? () => openQuestOnMap(q, elsewhere.id) : () => focusQuest(q);
  head.append(focus);
  const stateRow = el('div', 'progress-control');
  stateRow.append(el('span', '', 'My progress'));
  const select = el('select');
  select.id = 'quest-state';
  select.setAttribute('aria-label', 'Quest status');
  for (const [value, label] of [
    ['untracked', 'Untracked'],
    ['active', 'Active'],
    ['failed', 'Failed'],
    ['completed', 'Completed']
  ]) {
    const o = el('option', '', label);
    o.value = value;
    select.append(o);
  }
  select.value = status(q);
  select.onchange = async () => {
    try {
      await changeProgress({ type: 'quest', id: q.id, value: select.value });
      renderList();
      renderMarkers();
      toast('Quest progress saved locally.');
    } catch {
      select.value = status(q);
      toast('Could not save progress. Check available disk space.', 'error');
    }
  };
  stateRow.append(select);
  head.append(stateRow);
  /* An untracked quest draws nothing on the map, and until now nothing said
     so - the map was simply empty and the select read "Untracked", which is a
     true word that explains nothing. Say what is missing and what fixes it,
     here, where the fix is. */
  if (status(q) === 'untracked') {
    const because = availableBecause(q);
    const unlocks = because === 'prerequisites' ? unlockedByNames(q) : [];
    const points = objectivePoints(q).length;
    /* Two different claims, so two different sentences. "Unlocked by X" is a
       proof; "nothing recorded is holding it back" is the absence of one, and
       saying the first about the second would be inventing evidence. */
    const why = unlocks.length
      ? 'Unlocked by ' + unlocks.join(' and ') + '. '
      : because === 'nothing known'
        ? 'Waits on no other quest' +
          (q.minPlayerLevel
            ? /* "past" is wrong at the boundary, and the boundary is the
                 common case: the proven floor IS some quest's gate. */
              ' and wants level ' + q.minPlayerLevel + ', which you have reached'
            : '') +
          ', so nothing recorded here is holding it back. '
        : '';
    head.append(
      el(
        'small',
        'progress-hint',
        why +
          'This app has no record that you have taken it on, so it is left off the map' +
          (points
            ? ' - set it Active to put its ' +
              points +
              ' point' +
              (points === 1 ? '' : 's') +
              ' on ' +
              mapName(currentMapId) +
              '.'
            : '.')
      )
    );
  }
  panel.append(head);
  const questKeys = questKeyList(q);
  if (questKeys.length) {
    const gear = el('div', 'detail-section detail-kit');
    gear.append(el('div', 'section-title', 'KEYS TO BRING'));
    questKeys.forEach(k => {
      const row = el('p', 'requirement' + (k.optional ? ' optional-requirement' : ''));
      row.append(keyIconFor(k.label), el('span', '', k.label));
      const meta = [
        ...(q.mapIds?.length > 1 ? k.maps.map(mapName) : []),
        ...(k.optional ? ['optional objective'] : [])
      ];
      if (meta.length) row.append(el('small', '', meta.join(' · ')));
      gear.append(row);
    });
    gear.append(el('small', '', 'Keys for objectives you already confirmed are not listed.'));
    panel.append(gear);
  }
  const section = el('div', 'detail-section detail-objectives'),
    title = el('div', 'section-title');
  title.append(
    el('span', 'eyebrow', 'OBJECTIVES'),
    el('span', 'count', q.objectives.filter(isDone).length + ' / ' + q.objectives.length)
  );
  section.append(title);
  const objectiveMeter = el('progress', 'objective-meter');
  objectiveMeter.max = Math.max(1, q.objectives.length);
  objectiveMeter.value = q.objectives.filter(isDone).length;
  objectiveMeter.setAttribute('aria-label', 'Completed objectives');
  section.append(objectiveMeter);
  q.objectives.forEach((o, i) => {
    const progress = objectiveProgress(o),
      row = el(
        'div',
        'objective' +
          (isDone(o) ? ' done' : '') +
          (progress.source === 'ocr' && !progress.confirmed ? ' pending' : '')
      );
    const check = el('input');
    check.type = 'checkbox';
    check.checked = isDone(o);
    check.setAttribute('aria-label', 'Confirm objective ' + (i + 1));
    if (status(q) === 'completed') {
      // The quest is done, so every objective under it is too. Leaving the box
      // clickable would just snap back on the next render.
      check.disabled = true;
      check.title = 'This quest is marked completed.';
    }
    check.onchange = async () => {
      try {
        await changeProgress({
          type: 'objective-counter',
          id: o.id,
          value: check.checked ? progress.target : progress.target > 1 ? progress.value : 0,
          target: progress.target,
          confirmed: check.checked,
          source: 'manual'
        });
        renderDetail();
        renderMarkers();
      } catch {
        check.checked = isDone(o);
        toast('Could not save the objective.', 'error');
      }
    };
    /* The same five glyphs the map draws, beside the sentence they stand for.
       That is the legend: nobody has to be taught a magnifier once they have
       seen it next to "Find and obtain", and the two views stop being two
       separate vocabularies for one quest. */
    const verb = objectiveVerb(o);
    const mark = svg('svg', {
      class: 'objective-verb',
      viewBox: '-8 -8 16 16',
      'aria-hidden': 'true'
    });
    for (const shape of verbGlyph(verb, 'currentColor')) mark.append(shape);
    mark.appendChild(svg('title')).textContent = verbLabels[verb] || 'Objective';
    const body = el('div');
    body.append(el('p', '', o.description));
    if (o.optional) body.append(el('small', '', 'Optional objective'));
    (o.details || [])
      .filter(d => d !== 'Optional objective')
      .forEach(d => body.append(el('small', '', d)));
    if (o.itemNames?.length) body.append(el('small', '', 'Items: ' + o.itemNames.join(' · ')));
    if (o.requiredKeys?.length)
      body.append(
        el('small', '', 'Keys: ' + o.requiredKeys.map(group => group.join(' or ')).join(' + '))
      );
    const pts = objectivePoints(q, o.id);
    if (pts.length) {
      const b = el(
        'button',
        '',
        pts.some(p => p.candidate)
          ? '⌖ View possible location' + (pts.length > 1 ? 's' : '')
          : '⌖ View on map'
      );
      b.onclick = () => focusQuest(q, o.id);
      body.append(b);
    } else {
      const other = mappedElsewhere([o]);
      if (other) {
        const b = el('button', '', '⌖ View on ' + mapName(other.id) + ' ↗');
        b.title = 'Switch the tactical map to ' + mapName(other.id) + ' and show this objective';
        b.onclick = () => openQuestOnMap(q, other.id, o.id);
        body.append(b);
      } else body.append(el('small', '', 'No fixed ' + currentName + ' location in this dataset.'));
    }
    if (progress.target > 1) {
      const counter = el('div', 'objective-counter'),
        minus = el('button', '', '−'),
        value = el('strong', '', progress.value + ' / ' + progress.target),
        plus = el('button', '', '+');
      minus.setAttribute('aria-label', 'Decrease objective progress');
      plus.setAttribute('aria-label', 'Increase objective progress');
      minus.disabled = progress.value <= 0;
      plus.disabled = progress.value >= progress.target;
      const set = async next => {
        try {
          await changeProgress({
            type: 'objective-counter',
            id: o.id,
            value: next,
            target: progress.target,
            confirmed: next >= progress.target && progress.confirmed,
            source: 'manual'
          });
          renderDetail();
          renderMarkers();
        } catch {
          toast('Could not save the counter.', 'error');
        }
      };
      minus.onclick = () => set(Math.max(0, progress.value - 1));
      plus.onclick = () => set(Math.min(progress.target, progress.value + 1));
      counter.append(minus, value, plus);
      if (progress.source === 'ocr')
        counter.append(
          el(
            'small',
            progress.confirmed ? 'confirmed' : 'pending-review',
            progress.confirmed ? 'Confirmed from review' : 'OCR suggestion · confirm after raid'
          )
        );
      body.append(counter);
    }
    row.append(check, mark, body);
    section.append(row);
  });
  panel.append(section);
  const prerequisites = (q.requirements || [])
      .map(req => quests.find(x => x.id === requirementId(req)))
      .filter(Boolean),
    next = unlockedBy(q.id);
  if (prerequisites.length || next.length) {
    const chain = el('div', 'detail-section quest-chain');
    if (prerequisites.length) {
      chain.append(el('span', 'eyebrow', 'PREREQUISITES'));
      for (const item of prerequisites) {
        const b = el('button', 'chain-link', '← ' + item.name);
        b.onclick = () => selectQuest(item);
        chain.append(b);
      }
    }
    if (next.length) {
      chain.append(el('span', 'eyebrow', 'UNLOCKS NEXT'));
      for (const item of next.slice(0, 12)) {
        const b = el('button', 'chain-link', item.name + ' →');
        b.onclick = () => selectQuest(item);
        chain.append(b);
      }
    }
    const whole = el('button', 'chain-link chain-open', 'See the whole chain →');
    whole.title = 'Every quest before and after ' + q.name + ', by distance';
    whole.onclick = () => {
      renderChain(q);
      $('chain-dialog').showModal();
    };
    chain.append(whole);
    if (collectorPath().has(q.id))
      chain.append(el('span', 'pill kappa-path', 'Collector / Kappa path'));
    panel.append(chain);
  }
  const rewards = el('div', 'detail-section');
  rewards.append(el('div', 'section-title', 'REWARDS'));
  q.rewardSummary.forEach(r => rewards.append(el('div', 'reward', r)));
  panel.append(rewards);
  const notes = el('div', 'detail-section');
  notes.append(el('span', 'eyebrow', 'MY NOTES'));
  const textarea = el('textarea', 'quest-note');
  textarea.placeholder = 'Gear, route or reminder for this quest…';
  textarea.value = profile().questNotes?.[q.id] || '';
  let noteTimer;
  textarea.oninput = () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => {
      profile().questNotes ||= {};
      profile().questNotes[q.id] = textarea.value;
      await bridge.questMeta({ mode: data.mode, id: q.id, note: textarea.value });
    }, 400);
  };
  notes.append(textarea);
  panel.append(notes);
  panel.append(
    el(
      'p',
      'detail-note',
      (source(q) === 'logs'
        ? 'Quest status updated from the game logs. Objective counters need your confirmation or a reviewed Tasks screenshot.'
        : 'Manual quest status and objective counters.') +
        ' Saved separately for ' +
        data.mode.toUpperCase() +
        '. Quest data: ' +
        allData.generatedAt.slice(0, 10) +
        '. Possible item locations are candidates, not live loot.'
    )
  );
  describeBrief(q ? q.name + ' — quest brief' : 'Quest brief');
  /* Now, not next frame. The card is complete and something else may already
     have a frame pending from before it was built - and the pending one wins,
     because scheduleBriefAlign returns early when one is queued. That left the
     card 185px from where it belonged until a later, unrelated alignment
     happened to fix it. */
  if (briefAlignFrame) {
    cancelAnimationFrame(briefAlignFrame);
    briefAlignFrame = 0;
  }
  alignBrief();
}
