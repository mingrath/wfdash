// The overview — every wayfinder map you can see, across every repo, on one screen.
//
// A card is four things: the **title** (the identifier — `raglecture` alone holds seven
// maps, so `repo #number` cannot name one), `repo #number` (the disambiguator), and one
// bottom-aligned row carrying a segmented bar and one number.
//
// **The bar carries shape, the number carries volume, and neither does the other's job.**
// A fixed-width bar normalises map size away and inverts the ranking it appears to give —
// a 6-takeable map drew 83px of green against a 1-takeable map's 143px. A progress
// fraction is worse: `12/14 resolved` collides on real data, putting 30% of maps in a
// colliding pair.

import { esc } from './lib/markdown.js';
import { COUNT_KEYS, isDone, isEmpty, totalTickets, mapKey, signedDelta } from './lib/change.js';

const SEGMENT_COLOR = {
  frontier: '#3fb950',
  claimed: '#d29922',
  blocked: '#a371f7',
  undermined: '#f85149',
  resolved: '#388bfd',
  outOfScope: '#484f58',
};

/** The route a card navigates to — the dashboard's map view, never GitHub. */
export const routeOf = (m) => `/m/${m.repo}/${m.number}`;

function barHTML(counts) {
  const total = COUNT_KEYS.reduce((s, k) => s + (counts[k] ?? 0), 0);
  if (!total) return '';
  return (
    '<span class="bar">' +
    COUNT_KEYS.filter((k) => counts[k])
      .map(
        (k) =>
          `<i data-k="${k}" style="width:${(100 * counts[k]) / total}%;background:${SEGMENT_COLOR[k]}${
            k === 'resolved' || k === 'outOfScope' ? ';opacity:.5' : ''
          }"></i>`,
      )
      .join('') +
    '</span>'
  );
}

/**
 * Three degenerate states, each said in a word.
 *
 * A finished map and a stalled map draw the same picture — no green, everything else — so
 * colour alone can never separate them. Dimming a finished card was measured and rejected:
 * at 55% opacity it says `none takeable` and collapses into the stalled group, reproducing
 * the *unloaded* reading in a third place. A blank card is rejected too, being
 * indistinguishable from one that failed to render.
 */
function countsHTML(m, delta) {
  const c = m.counts;
  const deltaHTML = delta ? ` <span class="delta">${signedDelta(delta)}</span>` : '';
  if (isEmpty(m)) {
    // No bar at all — there is nothing to draw, and uncharted work must not read as
    // finished work or as a failed render.
    return `<span class="num empty">no tickets yet</span>`;
  }
  if (isDone(m)) {
    return `${barHTML(c)}<span class="num done">✓ all ${totalTickets(m)} resolved</span>${deltaHTML}`;
  }
  if (!c.frontier) {
    return `${barHTML(c)}<span class="num none">none takeable</span>${deltaHTML}`;
  }
  return `${barHTML(c)}<span class="num take">${c.frontier} takeable</span>${deltaHTML}`;
}

/**
 * Flat, three columns, bottom-aligned counts row.
 *
 * Three columns at 1440×900 puts every corpus card above the fold; two puts 16. Grouping
 * by repo is rejected — 12 headers for 20 maps, 10 governing a single card, costing 8
 * cards below the fold and 2.2× the height, to serve the one repo that has the problem.
 */
export function renderOverview(maps, host, { ringed = new Set(), deltas = new Map(), onOpen } = {}) {
  if (!maps.length) {
    host.innerHTML = `<h1>No wayfinder maps found</h1>
      <p class="sub">Nothing is labelled <code>wayfinder:map</code> where this account can see it.
      Empty is not an error — <code>gh search</code> returns no results and exits 0, so this
      looks exactly like success, because it is.</p>`;
    return;
  }

  const takeable = maps.reduce((s, m) => s + m.counts.frontier, 0);
  host.innerHTML =
    `<h1>${maps.length} map${maps.length === 1 ? '' : 's'}</h1>
     <p class="sub">${takeable} takeable ticket${takeable === 1 ? '' : 's'} · sorted takeable first</p>
     <div class="grid">` +
    maps
      .map((m) => {
        const key = mapKey(m);
        const d = deltas.get(key);
        return `<a class="card${ringed.has(key) ? ' ringed' : ''}" data-key="${esc(key)}" href="${esc(routeOf(m))}">
          <span class="title">${esc(m.title)}</span>
          <span class="where">${esc(m.repo)} <span class="n">#${m.number}</span></span>
          <span class="counts">${countsHTML(m, d?.frontier)}</span>
        </a>`;
      })
      .join('') +
    '</div>';

  // The whole card is one link, so there is never anything to aim at. A ticket is
  // deliberately not reachable from here: adding ticket identity was priced at cost 20→30
  // and 34KB→77KB on every poll, to place a link on a card with no room for it.
  host.querySelectorAll('.card').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      onOpen?.(a.getAttribute('href'));
    }),
  );
}

/** Rings and deltas update live inside the frozen order; only position is held. */
export function applyCardRings(host, ringed) {
  host.querySelectorAll('.card').forEach((c) => c.classList.toggle('ringed', ringed.has(c.dataset.key)));
}
