// The overview — every wayfinder map you can see, across every repo, on one screen.
//
// A card is four things: the **title** (the identifier — `raglecture` alone holds seven
// maps, so `repo #number` cannot name one), `repo #number` (the disambiguator), and one
// bottom-aligned row carrying a segmented bar and **two numbers**.
//
// **The bar carries shape, the numbers carry presence, and neither does the other's job.**
// A fixed-width bar normalises map size away and inverts the ordering it appears to give —
// a 6-takeable map drew 83px of green against a 1-takeable map's 143px. A progress
// fraction is worse: `12/14 resolved` collides on real data, putting 30% of maps in a
// colliding pair.
//
// ADR 0017 replaced ADR 0011's single `N takeable` with `N hitl · M afk`, counted over
// every live ticket rather than over the frontier. What that costs, and why it is paid, is
// under `countsHTML`.

import { esc } from './lib/markdown.js';
import { COUNT_KEYS, isDone, isEmpty, totalTickets, liveTickets, mapKey, signedDelta } from './lib/change.js';

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
 * The split the card draws, and the one answer available if it is ever missing.
 *
 * There is no measured case where the server sends a card without `attendance` — it ships
 * with the page. What is decided here is what to draw if one arrives anyway, and only one
 * answer is consistent with the rest of this file: the three numbers must sum to the live
 * work, so every live ticket counts as `unmarked`. That is what #70's third state means, and
 * it reads as *nobody has said*, where a card printing `0 hitl · 0 afk` over 12 open tickets
 * would simply be lying.
 */
const attendanceOf = (m) => m.attendance ?? { hitl: 0, afk: 0, unknown: liveTickets(m) };

/**
 * One clause per attendance state, in #70's order, and a `0` dimmer than the side it is on.
 *
 * Both numbers are drawn, always. Printing one alone when the other is `0` was measured and
 * rejected: it makes `1 afk` and `0 hitl · 1 afk` the same shape, and the card stops being
 * two peers. **9 of 17 live maps have a zero on one side**, so this is a main case rather
 * than a degenerate one — which is also why the zero dims instead of being drawn in its
 * side's own colour, where `0 hitl` reads as a bright zero.
 *
 * `unmarked` is a third clause and is **never folded into either side**: the numbers must
 * sum to the live work or the card is quietly wrong. It draws only when it is nonzero — 1
 * card in 25 today — and dim rather than amber, which was tried and became the brightest
 * text on the page, on the least actionable card in the corpus, colliding with `claimed` in
 * the bar. It is a footnote about data quality, not a warning.
 */
function presenceHTML(a) {
  const clause = (n, word, cls) => `<span class="${n === 0 ? 'zero' : cls}">${n} ${word}</span>`;
  // The spaces are in the markup rather than in a margin, so the row reads as a sentence
  // when it is copied or spoken and not only when it is looked at.
  const sep = '<span class="sep"> · </span>';
  return (
    clause(a.hitl, 'hitl', 'h') +
    sep +
    clause(a.afk, 'afk', 'a') +
    (a.unknown ? `${sep}<span class="unk">${a.unknown} unmarked</span>` : '')
  );
}

/**
 * The live card is a bar and two numbers; the two degenerate states are still each said in
 * a word.
 *
 * **The presence numbers are never green, and there is no `none takeable`.** ADR 0011 gave
 * green one job — *is there anything takeable, read with no reading* — and counting over all
 * live work puts a number on the card for work that cannot be started: on `webullopenapi#1`
 * and `raglecture#38` a green `3 hitl` would sit beside a bar with **no green segment at
 * all**, 4 of 25 cards. So `hitl` is white, `afk` is dim, and green stays in the bar, which
 * is now the only thing on the card that says whether anything is startable.
 *
 * Deleting the word is the deliberate half of that trade. ADR 0011 put `none takeable` into
 * words because colour could not separate a finished map from a stalled one — but those two
 * drew the same picture and these do not: finished draws `✓ all N resolved` in blue, stalled
 * draws two numbers beside a green-free bar. Keeping green *and* appending the phrase leaves
 * the contradiction standing and squeezes the bar to ~330px on the four cards least worth
 * reading.
 *
 * A blank card is rejected as before, being indistinguishable from one that failed to
 * render, and dimming a finished card is rejected on ADR 0011's own evidence — at 55%
 * opacity it collapses into the stalled group.
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
  return `${barHTML(c)}<span class="num live">${presenceHTML(attendanceOf(m))}</span>${deltaHTML}`;
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

  // The fleet in one line. `takeable` survives here even though it left the card: summed
  // across every map it answers *is there anything at all to start*, which no single bar
  // can, and it is the only place the word still appears.
  const takeable = maps.reduce((s, m) => s + m.counts.frontier, 0);
  const fleet = maps.reduce(
    (s, m) => {
      const a = attendanceOf(m);
      return { hitl: s.hitl + a.hitl, afk: s.afk + a.afk, unknown: s.unknown + a.unknown };
    },
    { hitl: 0, afk: 0, unknown: 0 },
  );
  host.innerHTML =
    `<h1>${maps.length} map${maps.length === 1 ? '' : 's'}</h1>
     <p class="sub">${takeable} takeable · ${fleet.hitl} hitl · ${fleet.afk} afk${
       fleet.unknown ? ` · ${fleet.unknown} unmarked` : ''
     }</p>
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
