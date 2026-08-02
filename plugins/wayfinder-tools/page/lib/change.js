// What "changed" means, on each route. Pure, and importable outside a browser.
//
// The two routes use different signals, and that is the design rather than an
// inconsistency: the map route watches tickets, the overview watches six integers.

/**
 * A ticket's change fingerprint: **status, assignee, title, blockers and comment count.**
 *
 * `updatedAt` is deliberately absent. On a ticket it churns on edits and reactions and
 * would ring nodes for nothing; on a map it is worse than twitchy, it is *blind* — a
 * parent issue is not touched when a child is closed, assigned or unblocked, so 69% of
 * count-moving events are invisible to it.
 */
export function fingerprint(graph) {
  const blockers = new Map();
  for (const e of graph.edges ?? []) {
    if (!blockers.has(e.blocked)) blockers.set(e.blocked, []);
    blockers.get(e.blocked).push(e.blocker);
  }
  const out = new Map();
  for (const n of graph.nodes ?? []) {
    out.set(
      n.number,
      [
        n.status,
        n.assignee ?? '',
        n.title,
        (n.comments ?? []).length,
        (blockers.get(n.number) ?? []).slice().sort((a, b) => a - b).join(','),
      ].join('|'),
    );
  }
  return out;
}

/** Which tickets moved, plus the ones that appeared. A vanished ticket is not a ring. */
export function changedNodes(prev, next) {
  const changed = [];
  for (const [num, fp] of next) {
    if (!prev.has(num)) changed.push(num);
    else if (prev.get(num) !== fp) changed.push(num);
  }
  return changed;
}

/** Did *this* ticket's own content move? The panel redraws on nothing less. */
export const selectionChanged = (prev, next, number) =>
  number != null && prev.has(number) && next.has(number) && prev.get(number) !== next.get(number);

export const COUNT_KEYS = ['frontier', 'claimed', 'blocked', 'undermined', 'resolved', 'outOfScope'];

/** A card's identity across polls. `repo#number` — the only pair that is 21 of 21 unique. */
export const mapKey = (m) => `${m.repo}#${m.number}`;

/**
 * The overview's signal: **a map whose six integers moved.** It costs nothing, because it
 * is already the card's entire content, and it moves on 782 of 793 count-moving events.
 *
 * The 11 it misses are a consequence rather than a gap: eight are a claim on a *blocked*
 * ticket, and `blocked` beats `claimed`, so that claim is invisible to `counts` by
 * construction — and invisible on the card too, so the signal loses nothing the drawing
 * had.
 */
export function changedMaps(prevMaps, nextMaps) {
  const prev = new Map((prevMaps ?? []).map((m) => [mapKey(m), m.counts]));
  const out = [];
  for (const m of nextMaps ?? []) {
    const before = prev.get(mapKey(m));
    if (!before) continue; // a map that has just appeared is not a *change* to a card
    const delta = {};
    let moved = false;
    for (const k of COUNT_KEYS) {
      const d = (m.counts[k] ?? 0) - (before[k] ?? 0);
      if (d) {
        delta[k] = d;
        moved = true;
      }
    }
    if (moved) out.push({ key: mapKey(m), delta });
  }
  return out;
}

/** `7 takeable −1` — the ring says which card, the delta says what moved. */
export const signedDelta = (n) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

// ------------------------------------------------------------------ the sort

const total = (c) => COUNT_KEYS.reduce((s, k) => s + (c[k] ?? 0), 0);
export const isDone = (m) => total(m.counts) > 0 && m.counts.resolved + m.counts.outOfScope === total(m.counts);
export const isEmpty = (m) => total(m.counts) === 0;
export const totalTickets = (m) => total(m.counts);
/** Open work, however it is held up — the scope the attendance split is counted over. */
export const liveTickets = (m) => m.counts.frontier + m.counts.claimed + m.counts.blocked + m.counts.undermined;

/**
 * The four bands, in reading order: **takeable → stalled → uncharted → finished**.
 *
 * Uncharted above finished on purpose: charting is work, and a map that still needs it
 * belongs nearer the top than one that needs nothing.
 */
export const bandOf = (m) => (isEmpty(m) ? 2 : isDone(m) ? 3 : m.counts.frontier ? 0 : 1);

/**
 * **Recency, banded** — newest-edited first inside each band. ADR 0017 replaces ADR 0011's
 * frontier-count order with this.
 *
 * Pure last-modified was asked for and is free, since `updatedAt` is already on the wire,
 * and it fails on the corpus exactly as ADR 0011 predicted it would: **three finished maps
 * take slots 4, 5 and 6**, and `raglecture#53` — 11 hitl, the most presence-hungry map in
 * the fleet — falls to 22 of 25. The bands are what stop that, and they cost one term.
 *
 * Sorting on the printed `hitl` count was the obvious alternative and lost twice over:
 * ranked on the *live* count it lifts two maps with nothing startable to slots 8–9, and
 * ranked on the *takeable* count while printing the live one it becomes a **hidden key** —
 * `4 hitl` outranking `6 hitl` for no visible reason, the same defect ADR 0011 recorded in
 * the fixed-width bar. Banded recency puts every card that can be acted on in slots 1–13
 * and stays a rule the reader can state.
 */
export function sortMaps(maps) {
  return [...maps].sort(
    (a, b) => bandOf(a) - bandOf(b) || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')),
  );
}

// ------------------------------------------------------------------ backoff

/**
 * Backoff, reset on first success and immediately on focus. Polling through a rate limit
 * deepens it, and the dashboard's own share of the budget cannot plausibly self-inflict
 * one — so a rate limit means an agent session is doing real work, and backing off yields
 * it the budget.
 */
export const backoffFor = (steps, failures) => steps[Math.min(Math.max(failures, 1) - 1, steps.length - 1)];
