// The drawing. SVG generated from the layout, holding no user state, so it is cheap to
// re-render wholesale on every change.
//
// Colour encodes status; status is never written. Colouring by *type* was measured and
// rejected: `task` + `grilling` are 84% of the corpus, so the palette degenerates to two
// colours on exactly the maps that need help, while the thing you are scanning for — what
// is takeable — becomes a dash pattern.

import {
  W,
  COLLAPSED,
  TITLE_PX,
  META_PX,
  DONE,
  LIVE,
  TAKEABLE,
  HAS_STRIP,
  ATTEND_LABEL,
  attendOf,
  buildLayout,
  geometry,
  fitFor,
  titleLines,
  numberRoom,
  chainPath,
  clip,
} from './lib/layout.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, parent) => {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};

/**
 * Green = go, amber = someone has it, violet = waiting, blue = done.
 *
 * Violet is not taste: measured on the one fixture carrying four live statuses at once,
 * rose collides with `claimed` amber and steel collides with `resolved` blue. It is the
 * only hue left, and the palette is exhausted — which is why change takes no hue at all.
 */
export const STATUS_COLOR = {
  frontier: '#3fb950',
  claimed: '#d29922',
  blocked: '#a371f7',
  resolved: '#388bfd',
  'out-of-scope': '#484f58',
  undermined: '#f85149',
};

export const TYPE_GLYPH = { grilling: '◆', research: '◇', prototype: '△', task: '□' };

/** One box. `resolved` and `out-of-scope` recede to a chip; nothing else does. */
function drawNode(node, group, w, h) {
  const colour = STATUS_COLOR[node.status] ?? '#8b949e';

  if (DONE(node)) {
    el('rect', { class: 'frame', width: w, height: h, rx: 4, fill: '#11151b', stroke: '#1c2128' }, group);
    el('rect', { width: 3, height: h, fill: colour, 'fill-opacity': 0.5 }, group);
    // `#n` at title size. A chip cannot carry a title and does not pretend to — even at a
    // full 220px it fits 0–17% of real titles — so the number is the whole legend, and it
    // inherits the title's legibility budget instead of running its own.
    const label = el(
      'text',
      { x: 9, y: 15, class: 'num', style: `font-size:${TITLE_PX}px`, 'fill-opacity': 0.85 },
      group,
    );
    label.textContent = `#${node.number}`;
    if (node.status === 'out-of-scope') label.setAttribute('text-decoration', 'line-through');
    if (w > COLLAPSED + 20) {
      const room = Math.floor((w - 34 - `#${node.number}`.length * 6.4) / 5.6);
      el('text', { x: 9 + `#${node.number} `.length * 6.4, y: 15, class: 'meta', 'fill-opacity': 0.6 }, group)
        .textContent = clip(node.title, room);
    }
    // Nothing on a chip said *finished*: no tick, no rule-through, no word — so a
    // fully-resolved map read as *unloaded*. A mark, not texture.
    el(
      'text',
      { x: w - 7, y: 16, 'text-anchor': 'end', fill: colour, 'fill-opacity': 0.9, style: 'font-size:11px' },
      group,
    ).textContent = '✓';
    return;
  }

  const loud = node.status === 'frontier';
  const blocked = node.status === 'blocked';
  el(
    'rect',
    {
      class: 'frame',
      width: w,
      height: h,
      rx: 6,
      fill: loud ? colour : 'var(--panel)',
      'fill-opacity': loud ? 0.15 : 1,
      stroke: colour,
      'stroke-width': loud ? 2 : 1.3,
      'stroke-dasharray': blocked ? '5 3' : 'none',
      'stroke-opacity': blocked ? 0.85 : 1,
    },
    group,
  );
  // The dash says *waiting*; the hue says *live*. Grey was only ever saying the second
  // half, and 18% of the corpus landed on the dead side of the map because of it. The fill
  // sits at 7% so `frontier`'s 15% wash keeps its lead.
  if (blocked) el('rect', { width: w, height: h, rx: 6, fill: colour, 'fill-opacity': 0.07 }, group);

  const room = numberRoom(node);
  const lines = titleLines(node, w);
  lines.forEach((text, i) => {
    el('text', { x: 11 + (i === 0 ? room : 0), y: 16 + i * 14, class: 'ttl', 'fill-opacity': blocked ? 0.8 : 1 }, group)
      .textContent = text;
  });
  // `#n` rides line 1 at title size. A corner tag cost 7 points of title fit because an
  // inset narrows *every* line; a leading `#n ` narrows line 1 only, and measured title
  // fit is unchanged on all five fixtures.
  el('text', { x: 11, y: 16, class: 'num', style: `font-size:${TITLE_PX}px`, 'fill-opacity': 0.75 }, group)
    .textContent = `#${node.number}`;

  if (!HAS_STRIP(node)) return;
  const baseline = h - 6;
  if (node.status === 'claimed' && node.assignee) {
    el('text', { x: 11, y: baseline, class: 'meta', 'fill-opacity': 0.85 }, group).textContent = `@${node.assignee}`;
  }
  if (loud) {
    // Type earns its place on exactly this box: it decides *who* takes the ticket — a
    // `research` ticket goes to an agent unattended, a `grilling` needs a human in the
    // room. On every other status that question is not being asked.
    //
    // The second half is now the ticket's own answer to that same question rather than
    // `takeable`, which the lane head has already said for the whole column. It is **5
    // characters shorter** than the word it replaces, so ADR 0010's fight for this line is
    // not reopened; widest real case `◆ grilling · hitl` fits at 220px.
    el(
      'text',
      { x: w - 9, y: baseline, class: 'meta', 'text-anchor': 'end', fill: colour, style: `font-size:${META_PX}px` },
      group,
    ).textContent = `${TYPE_GLYPH[node.type] ?? '·'} ${node.type ?? 'untyped'} · ${ATTEND_LABEL[attendOf(node)]}`;
  }
}

/**
 * What a column is called. `rank 3` named the axis; nothing on the live half of the map is
 * laned by rank any more, so it would name nothing the reader can see.
 *
 * The count on the batch is of **takeable** tickets, not of everything in the column: a
 * claimed ticket sits at wave 0 too — it has no open blocker — and it is not something you
 * can start.
 */
function laneHead(col, lane, batch) {
  const live = col.filter((it) => it.kind === 'node' && LIVE(it.node));
  if (!live.length) return { text: 'done', tone: 'muted' };
  const wave = lane - batch;
  if (wave === 0) return { text: `start now — ${live.filter((it) => TAKEABLE(it.node)).length} in parallel`, tone: 'go' };
  if (wave === 1) return { text: `then — ${live.length} waiting`, tone: 'wait' };
  return { text: `+${wave} — ${live.length} waiting`, tone: 'wait' };
}

/**
 * Draw the whole graph into `stage` and return what was measured, not what was predicted.
 * `scale` is the fit actually applied; `raw` is the fit before the 100% cap, which is the
 * number an earlier report mistook for the rendered one.
 */
export function drawGraph(graph, stage, { selected = null, ringed = new Set(), onSelect, onHover } = {}) {
  stage.textContent = '';
  const layout = buildLayout(graph);
  if (!layout.rows.length) return { layout, scale: 1, raw: 1, geo: null };

  const geo = geometry(layout);
  const { raw, fit } = fitFor(geo.width, stage.clientWidth || 1440);

  const svg = el('svg', { width: geo.width * fit, height: geo.height * fit, viewBox: `0 0 ${geo.width} ${geo.height}` }, stage);
  const edgeLayer = el('g', { class: 'edges' }, svg);
  const nodeLayer = el('g', { class: 'nodes' }, svg);

  const statusOf = new Map(graph.nodes.map((n) => [n.number, n.status]));
  layout.rows.forEach((col, r) => {
    const head = laneHead(col, r, layout.batch);
    el('text', { x: geo.xs[r], y: 46, class: `lane-head ${head.tone}` }, svg).textContent = head.text;
    for (const it of col) {
      if (it.kind !== 'node') continue;
      const g = el('g', { class: 'node', 'data-n': it.node.number, transform: `translate(${it.x},${it.y})` }, nodeLayer);
      drawNode(it.node, g, it.w, it.h);
      if (it.node.number === selected) g.classList.add('sel');
      if (ringed.has(String(it.node.number))) g.classList.add('ringed');
    }
    // Sub-heads for the attendance runs, against the first box of each. Only the batch
    // column has runs — it is the only column `buildLayout` re-sorts — and only the batch
    // column is being asked *who takes this*.
    if (r !== layout.batch) return;
    let last = null;
    for (const it of col) {
      if (it.kind !== 'node') continue;
      const key = attendOf(it.node);
      if (key === last) continue;
      el('text', { x: geo.xs[r], y: it.y - 5, class: `grp g-${key}` }, svg).textContent =
        `${ATTEND_LABEL[key]} · ${col.filter((c) => c.kind === 'node' && attendOf(c.node) === key).length}`;
      last = key;
    }
  });

  layout.chains.forEach((chain, i) => {
    if (!chain) return;
    const e = graph.edges[i];
    // No `satisfied` flag on the wire: an edge is cleared iff its blocker is finished, and
    // storing that would duplicate state a refresh has to keep in step.
    const cleared = statusOf.get(e.blocker) === 'resolved' || statusOf.get(e.blocker) === 'out-of-scope';
    el(
      'path',
      { d: chainPath(chain), class: `edge${cleared ? ' cleared' : ''}`, 'data-a': e.blocker, 'data-b': e.blocked },
      edgeLayer,
    );
  });

  // Waypoints are layout-only. They never appear in the contract, they are never drawn,
  // and they are not clickable — the only thing they do is take part in the ordering, so
  // that a long edge owns its lane by construction.
  for (const g of nodeLayer.children) {
    const num = Number(g.dataset.n);
    g.addEventListener('mouseenter', () => {
      highlight(stage, num);
      onHover?.(num);
    });
    g.addEventListener('mouseleave', () => {
      highlight(stage, null);
      onHover?.(null);
    });
    g.addEventListener('click', () => onSelect?.(num));
  }

  return { layout, geo, scale: fit, raw, svg };
}

/** Hovering a ticket dims everything not connected to it — what makes a busy graph traceable. */
export function highlight(stage, num) {
  const edges = stage.querySelectorAll('.edge');
  edges.forEach((p) => p.classList.toggle('hot', num != null && (p.dataset.a === String(num) || p.dataset.b === String(num))));
  const nodes = stage.querySelectorAll('.node');
  if (num == null) {
    nodes.forEach((n) => n.classList.remove('dim'));
    return;
  }
  const touched = new Set([String(num)]);
  stage.querySelectorAll('.edge.hot').forEach((p) => {
    touched.add(p.dataset.a);
    touched.add(p.dataset.b);
  });
  nodes.forEach((n) => n.classList.toggle('dim', !touched.has(n.dataset.n)));
}

/** Ringing is applied without a redraw, so a ring can accumulate across polls. */
export function applyRings(stage, ringed) {
  stage.querySelectorAll('.node').forEach((n) => n.classList.toggle('ringed', ringed.has(n.dataset.n)));
}

/** Transient emphasis for a prose link pointing at a node on this map. */
export function emphasise(stage, num) {
  stage.querySelectorAll('.node').forEach((n) => n.classList.toggle('hl', num != null && n.dataset.n === String(num)));
}
