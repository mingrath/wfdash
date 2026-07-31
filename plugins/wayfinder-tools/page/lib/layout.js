// Layout — rank as a column, barycentre within it, waypoints for the long edges.
//
// Pure. No DOM, no globals: the same functions the page draws with are the ones a test
// imports directly, because the browser adds nothing to a function that only does
// arithmetic. What the browser *is* still needed for — fit scale, crossing counts read off
// rendered geometry — stays in the browser, because a predicted pixel is not evidence.
//
// The orientation is decided by the corpus, not by taste: wayfinder maps are wider than
// they are deep (depth median 3 / max 8; width median 4 / max 16), so ticket count belongs
// on the axis a browser scrolls for free.

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
 * Rows of items per rank, with dummy waypoints threaded through rank-skipping edges, then
 * ordered by barycentre.
 *
 * Waypoints take part in the ordering exactly like real tickets, so a long edge occupies
 * its own lane **by construction**. Post-hoc lane routing was built first and swept the
 * full page width to join two adjacent boxes, because ordering has already used the free
 * space by the time it runs.
 */
export function buildLayout(graph) {
  const nodes = graph.nodes ?? [];
  if (!nodes.length) return { rows: [], chains: [], ranks: 0, items: [] };

  const maxRank = Math.max(...nodes.map((n) => n.rank ?? 0));
  const rows = Array.from({ length: maxRank + 1 }, () => []);
  const items = [];
  const mk = (o) => {
    o.id = items.length;
    items.push(o);
    rows[o.rank].push(o);
    return o;
  };

  const byNumber = new Map();
  // Ascending issue number is the tie-break, so a new ticket always gets the highest id
  // and sorts last within its rank: it appends rather than displaces.
  for (const n of [...nodes].sort((a, b) => a.number - b.number)) {
    byNumber.set(n.number, mk({ kind: 'node', node: n, rank: n.rank ?? 0, pred: [], succ: [] }));
  }

  const chains = (graph.edges ?? []).map((e) => {
    const a = byNumber.get(e.blocker);
    const b = byNumber.get(e.blocked);
    if (!a || !b) return null;
    const chain = [a];
    for (let r = a.rank + 1; r < b.rank; r++) chain.push(mk({ kind: 'dummy', rank: r, pred: [], succ: [] }));
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
  return { rows, chains, ranks: maxRank + 1, items };
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
