// Layout — wave as a column, barycentre within it, waypoints for the long edges.
//
// Pure. No DOM, no globals: the same functions the page draws with are the ones a test
// imports directly, because the browser adds nothing to a function that only does
// arithmetic. What the browser *is* still needed for — fit scale, crossing counts read off
// rendered geometry — stays in the browser, because a predicted pixel is not evidence.
//
// The orientation is decided by the corpus, not by taste: wayfinder maps are wider than
// they are deep (depth median 3 / max 8; width median 4 / max 16), so ticket count belongs
// on the axis a browser scrolls for free.
//
// ADR 0018 replaced the column axis. It used to be the contract's `rank`, which counts
// *closed* blockers too, so a ticket unblocked this morning still drew four columns deep:
// takeable tickets are scattered across ranks on all four maps measured (`vetvillepet-seo#2`
// r0: 2 / r1: 5; `MOOD-diagnosis-new#156` r0: 6 / r1: 1 / r4: 1). It is now the **wave**,
// which counts open blockers only, so column 0 is takeable-now by construction. Max wave is
// **1** on all four maps measured — a map's depth is almost entirely history.

/** ADR 0007/0010 geometry. A live box is 220px; a column with nothing live is 104px. */
export const W = 220;
export const COLLAPSED = 104;
export const CHIP_H = 22;
export const LINE_H = 14;
export const TITLE_PX = 11.5;
export const META_PX = 9.5;
export const GAP_X = 92;
export const GAP_Y = 18;
export const DUMMY_H = 14;
/** The pad the fit leaves so a 100% drawing is not flush against the stage edge. */
export const FIT_PAD = 8;

export const DONE = (n) => n.status === 'resolved' || n.status === 'out-of-scope';
/** The two statuses that still have something the panel cannot be. */
export const HAS_STRIP = (n) => n.status === 'claimed' || n.status === 'frontier';
/** Everything that is not finished — the half of the map ADR 0018 lanes by wave. */
export const LIVE = (n) => !DONE(n);
/** Open, unblocked, unclaimed — plus `undermined`, which is open and has nothing holding it. */
export const TAKEABLE = (n) => n.status === 'frontier' || n.status === 'undermined';

/**
 * `hitl` first, the unmarked next, `afk` last — the order the batch column is re-sorted into.
 *
 * Unmarked sits between rather than with either side: #70 made it a permanent third contract
 * value, and #77 only makes it behave as `hitl` where something is *forced* to choose. A
 * column has room for three runs, so it is not forced.
 */
export const attendKey = (n) => ({ hitl: 0, afk: 2 })[n.attendance] ?? 1;
export const attendOf = (n) => n.attendance ?? 'unknown';
/**
 * The labels verbatim, not a translation of them. `unattended` was built and rejected on
 * sight: this page already says `takeable` for a ticket nobody has picked up, so
 * "unattended · 4" cannot be told apart from "unclaimed · 4" — two axes, one word. `afk`
 * also describes the *dev* rather than the ticket, and every paraphrase that fixed that
 * invented a term the labels do not carry. `unmarked` is #77's own word for the residue.
 */
export const ATTEND_LABEL = { hitl: 'hitl', afk: 'afk', unknown: 'unmarked' };

/**
 * `wave` — how many rounds of waiting a live ticket is from being takeable. 0 is the batch.
 *
 * Page-side arithmetic, derived from `status` and `edges`, both already on the wire. Nothing
 * new reaches `reader.js`: computing it server-side was rejected for the reason the reader
 * already gives for not storing a `satisfied` flag on an edge — it duplicates state a
 * refresh then has to keep in step.
 */
export function waves(graph) {
  const live = new Set((graph.nodes ?? []).filter(LIVE).map((n) => n.number));
  const blockers = new Map([...live].map((k) => [k, []]));
  for (const e of graph.edges ?? []) {
    if (live.has(e.blocked) && live.has(e.blocker)) blockers.get(e.blocked).push(e.blocker);
  }
  const memo = new Map();
  // `seen` is the cycle guard the reader's own rank walk has; a cycle throws there long
  // before it reaches here, so this only has to not hang if one ever does.
  const depth = (num, seen = new Set()) => {
    if (memo.has(num)) return memo.get(num);
    if (seen.has(num)) return 0;
    seen.add(num);
    const up = blockers.get(num) ?? [];
    const d = up.length ? 1 + Math.max(...up.map((b) => depth(b, seen))) : 0;
    memo.set(num, d);
    return d;
  };
  const out = new Map();
  for (const num of live) out.set(num, depth(num));
  return out;
}

/**
 * Which column each ticket lands in, and where the batch column is.
 *
 * Done tickets keep their **real rank**, compacted to the ranks that actually hold one, in a
 * block on the left — so ADR 0007's 104px column collapse is untouched and history still
 * reads left to right. This is the one place on the page where `rank` still decides a pixel:
 * on `MOOD-diagnosis-new#156` it spreads 49 chips over 4 collapsed columns instead of
 * stacking them into one ~2000px column.
 *
 * Live tickets lane by wave, to the right of the whole done block, which puts every takeable
 * ticket — whatever its rank — in one column.
 */
export function laneAssignment(graph) {
  const nodes = graph.nodes ?? [];
  const w = waves(graph);
  const held = [...new Set(nodes.filter(DONE).map((n) => n.rank ?? 0))].sort((a, b) => a - b);
  const compact = new Map(held.map((r, i) => [r, i]));
  const batch = held.length;
  const of = new Map();
  for (const n of nodes) {
    of.set(n.number, DONE(n) ? compact.get(n.rank ?? 0) : batch + (w.get(n.number) ?? 0));
  }
  return { of, batch, waves: w };
}

/** Truncate with a mark, so an overflow is stated rather than silently cut. */
export const clip = (s, n) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s);

/**
 * Greedy wrap into at most `lines` lines of `cols` characters.
 *
 * Trailing lines are dropped when the title is short, which is what lets a box be as tall
 * as the lines it actually draws — the fixed three-line box carried a visible void under
 * every short title, and height is free because the fit is width-bound.
 */
export function wrapN(s, cols, lines) {
  const words = String(s).split(/\s+/).filter(Boolean);
  const out = [];
  let i = 0;
  for (let l = 0; l < lines; l++) {
    let acc = '';
    while (i < words.length && (acc + (acc ? ' ' : '') + words[i]).length <= cols) {
      acc += (acc ? ' ' : '') + words[i];
      i++;
    }
    if (!acc && i < words.length) {
      acc = words[i].slice(0, cols);
      i++;
    }
    out.push(acc);
  }
  if (i < words.length) out[lines - 1] = clip(out[lines - 1] + ' ' + words.slice(i).join(' '), cols);
  while (out.length > 1 && !out[out.length - 1]) out.pop();
  return out;
}

/** Leading room on line 1 for `#n `, which rides the title at title size. */
export const numberRoom = (n) => `#${n.number} `.length * 6.4;

export function titleLines(n, w = W) {
  return wrapN(n.title, Math.floor((w - 22 - numberRoom(n)) / 6.1), 3);
}

/**
 * A box is as tall as the lines it draws. `resolved` and `out-of-scope` collapse to a
 * chip; nothing else recedes — shrinking `blocked` too was measured and reproduced the
 * exact defect the three-line box exists to fix, across 18% of the corpus.
 */
export function boxHeight(n) {
  if (DONE(n)) return CHIP_H;
  return (HAS_STRIP(n) ? 22 : 14) + titleLines(n).length * LINE_H;
}

/**
 * The batch column re-sorted `hitl` → unmarked → `afk`, with a layout-only spacer between
 * the runs.
 *
 * A spacer is the waypoint trick again: it takes a slot and a height and is never drawn,
 * which is how a group divider buys its gap without a second geometry pass.
 *
 * This runs **after** barycentre and it overrules it, on this one column and no other. The
 * attendance split is a promise the lane head makes to the reader; barycentre is only a
 * crossing count, and ADR 0003 measured its 4× reduction over the whole drawing, not over
 * any one lane of it.
 */
function groupByAttendance(col, lane) {
  // Nothing to separate, nothing to spend. A column whose tickets all carry the same mark —
  // or none, which is every map recorded before the fleet backfill — keeps barycentre
  // untouched, and so does the whole synthetic stress graph the 4× reduction is measured on.
  const marks = new Set(col.filter((it) => it.kind === 'node').map((it) => attendOf(it.node)));
  if (marks.size < 2) return col;

  // Sorted on the attendance key alone. `Array#sort` is stable, so barycentre survives
  // *inside* each run and only the ordering between runs is spent.
  //
  // Waypoints sort past the last run. Leaving each one in the slot barycentre gave it is
  // cheaper — 209 crossings against 114 on the stress graph, counted ADR 0003's way — and it
  // was built that way first and reverted: a long edge has no attendance, and the batch
  // column of `MOOD-diagnosis-new#156` threads **16** of them, 10 of which land mid-run and
  // blow a 320px hole through a block the sub-head above it says is contiguous. The runs are
  // the promise; the crossing count is what pays for it.
  const ordered = [...col].sort((a, b) => {
    const k = (it) => (it.kind === 'node' ? attendKey(it.node) : 9);
    return k(a) - k(b);
  });

  const out = [];
  let last = null;
  let n = 0;
  for (const it of ordered) {
    const key = it.kind === 'node' ? attendOf(it.node) : null;
    if (last && key && key !== last) out.push({ kind: 'spacer', lane, id: -1000 - n++, pred: [], succ: [] });
    if (key) last = key;
    out.push(it);
  }
  return out;
}

/**
 * Rows of items per lane, with dummy waypoints threaded through lane-skipping edges, then
 * ordered by barycentre.
 *
 * Waypoints take part in the ordering exactly like real tickets, so a long edge occupies
 * its own lane **by construction**. Post-hoc lane routing was built first and swept the
 * full page width to join two adjacent boxes, because ordering has already used the free
 * space by the time it runs.
 */
export function buildLayout(graph) {
  const nodes = graph.nodes ?? [];
  if (!nodes.length) return { rows: [], chains: [], lanes: 0, items: [], batch: 0 };

  const { of: laneOf, batch } = laneAssignment(graph);
  const width = Math.max(...nodes.map((n) => laneOf.get(n.number) ?? 0)) + 1;
  const rows = Array.from({ length: width }, () => []);
  const items = [];
  const mk = (o) => {
    o.id = items.length;
    items.push(o);
    rows[o.lane].push(o);
    return o;
  };

  const byNumber = new Map();
  // Ascending issue number is the tie-break, so a new ticket always gets the highest id
  // and sorts last within its lane: it appends rather than displaces.
  for (const n of [...nodes].sort((a, b) => a.number - b.number)) {
    byNumber.set(n.number, mk({ kind: 'node', node: n, lane: laneOf.get(n.number) ?? 0, pred: [], succ: [] }));
  }

  const chains = (graph.edges ?? []).map((e) => {
    const a = byNumber.get(e.blocker);
    const b = byNumber.get(e.blocked);
    if (!a || !b) return null;
    const chain = [a];
    for (let l = a.lane + 1; l < b.lane; l++) chain.push(mk({ kind: 'dummy', lane: l, pred: [], succ: [] }));
    chain.push(b);
    for (let k = 0; k < chain.length - 1; k++) {
      chain[k].succ.push(chain[k + 1]);
      chain[k + 1].pred.push(chain[k]);
    }
    return chain;
  });

  const pos = new Map();
  const reindex = () => rows.forEach((r) => r.forEach((it, i) => pos.set(it.id, i)));
  reindex();
  // Ten alternating sweeps. Measured on the 40-ticket stress graph at maximum density:
  // 293 crossings without, 73 with. Not a polish step and not optional.
  for (let sweep = 0; sweep < 10; sweep++) {
    const forward = sweep % 2 === 0;
    const order = forward ? [...rows.keys()] : [...rows.keys()].reverse();
    for (const ri of order) {
      const key = forward ? 'pred' : 'succ';
      rows[ri].sort((a, b) => {
        const bc = (it) =>
          it[key].length ? it[key].reduce((s, m) => s + pos.get(m.id), 0) / it[key].length : pos.get(it.id);
        return bc(a) - bc(b) || a.id - b.id;
      });
      reindex();
    }
  }
  if (rows[batch]) rows[batch] = groupByAttendance(rows[batch], batch);
  return { rows, chains, lanes: width, items, batch };
}

/**
 * viewBox-space positions for everything the drawing contains.
 *
 * Independent of the fit, which is why there is no settling loop: the metadata strip is
 * unconditional on its two statuses, so nothing about a box's height depends on how small
 * the page ends up drawing it.
 */
export function geometry(layout) {
  const wid = layout.rows.map((col) => (col.some((it) => it.kind === 'node' && !DONE(it.node)) ? W : COLLAPSED));
  const hOf = (it) => (it.kind === 'node' ? boxHeight(it.node) : DUMMY_H);
  const colH = (col) => col.reduce((s, it) => s + hOf(it) + GAP_Y, -GAP_Y);

  const xs = [];
  let x = 40;
  for (const w of wid) {
    xs.push(x);
    x += w + GAP_X;
  }
  const height = (layout.rows.length ? Math.max(...layout.rows.map(colH)) : 0) + 96;
  const width = layout.rows.length ? x - GAP_X + 40 : 0;

  const placed = [];
  layout.rows.forEach((col, r) => {
    let y = (height - colH(col)) / 2 + 34;
    for (const it of col) {
      const h = hOf(it);
      it.x = xs[r];
      it.y = y;
      it.w = wid[r];
      it.h = h;
      it.left = it.kind === 'node' ? xs[r] : xs[r] + wid[r] / 2;
      it.right = xs[r] + wid[r];
      it.cy = y + h / 2;
      placed.push(it);
      y += h + GAP_Y;
    }
  });

  return { xs, wid, width, height, colH, hOf, placed };
}

/**
 * Fit to width, capped at 100%. The page never scrolls horizontally; vertical scroll
 * handles ticket count.
 *
 * No scale floor. It stays the named escape hatch, priced at 415px of horizontal scroll on
 * the deepest map, and stays unbuilt — 56% was checked in a browser and read without
 * difficulty, because SVG text scales cleanly and character cells do not.
 */
export function fitFor(width, available) {
  if (!width) return { raw: 1, fit: 1 };
  const raw = (available - FIT_PAD) / width;
  return { raw, fit: Math.min(1, raw) };
}

/** One bezier per consecutive pair, so a long edge reads as one continuous curve. */
export function chainPath(chain) {
  let d = `M${chain[0].right},${chain[0].cy}`;
  for (let k = 1; k < chain.length; k++) {
    const p = chain[k - 1];
    const q = chain[k];
    const dx = Math.max(30, (q.left - p.right) * 0.5);
    d += ` C${p.right + dx},${p.cy} ${q.left - dx},${q.cy} ${q.left},${q.cy}`;
    if (q.kind === 'dummy') d += ` L${q.right},${q.cy}`;
  }
  return d;
}
