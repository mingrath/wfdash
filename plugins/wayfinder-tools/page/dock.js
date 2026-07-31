// The dock — the page's prose surface, and the clearest thing the pivot to a browser
// bought. A resolved ticket *is* a decision, and its worth is the prose in its thread; a
// terminal had nowhere to put that.
//
// Three states: **map panel** (the default on load), **ticket panel**, closed. `esc`
// deselects back to the map panel rather than closing; a separate control closes the dock
// entirely and hands the graph its full width back.

import { md, esc, inline, commentKind } from './lib/markdown.js';
import { STATUS_COLOR, TYPE_GLYPH } from './graph.js';
import { DONE } from './lib/layout.js';

const kb = (s) => `${(new TextEncoder().encode(s).length / 1024).toFixed(1)}KB`;
const day = (iso) => (iso ? String(iso).slice(0, 10) : '');

/**
 * Each surface remembers where it was left, across the map↔ticket swap.
 *
 * Selecting a *different* ticket still starts at the top — that is a new read, not a
 * resumption — so the ticket key is reset when the selection moves rather than kept per
 * ticket number.
 */
const scrollMemory = new Map();
let lastTicket = null;

export function rememberScroll(scroller, surface) {
  scrollMemory.set(surface, scroller.scrollTop);
}

function restoreScroll(scroller, surface) {
  scroller.scrollTop = scrollMemory.get(surface) ?? 0;
}

/**
 * Sticky labels need to know how tall the header they stick under is, and it is not a
 * constant — the ticket panel's header wraps its pills on a long title. Measured on the
 * real render rather than assumed.
 */
function setStop(scroller) {
  const head = scroller.querySelector('.ph');
  scroller.style.setProperty('--stop', `${head ? Math.round(head.getBoundingClientRect().height) : 0}px`);
}

/**
 * A markdown link pointing at a ticket on *this* map selects that ticket instead of
 * navigating to GitHub, so prose and drawing are one surface.
 *
 * This is a per-**link** rule and never a per-item one. 57% of Decisions-so-far items that
 * name a ticket name more than one, so an item naming four tickets gets four working links
 * and no claim about which one it belongs to. No prose is ever *attributed* to a node.
 */
const ticketLinker = (graph) => (rawUrl) => {
  const m = /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/.exec(rawUrl);
  if (!m) return null;
  const number = Number(m[3]);
  if (`${m[1]}/${m[2]}` !== graph.repo) return null;
  if (!graph.nodes.some((n) => n.number === number)) return null;
  return { href: `?t=${number}`, attrs: ` class="tref" data-goto="${number}"` };
};

// ------------------------------------------------------------------ the map panel

/**
 * The map's own body. It drops the destination (the masthead is it) and the footer, keeps
 * `key: null` sections like any other, and collapses Decisions-so-far by default.
 *
 * Decisions-so-far earns the collapse twice: it is up to 71% of a body and 49KB at the
 * extreme, and it is the only section whose subject matter the page already draws — every
 * item is about closed tickets that are nodes, whose resolution comments are one click
 * away in the ticket panel.
 */
export function renderMapPanel(graph, scroller, { onSelect, onHover } = {}) {
  const link = ticketLinker(graph);
  const sections = (graph.map.sections ?? []).filter((s) => s.key !== 'destination');

  let html = `<div class="ph">
    <h2>${esc(graph.map.title)}</h2>
    <div class="m">
      <span>${esc(graph.repo)} #${graph.map.number}</span>
      <span>${graph.nodes.length} ticket${graph.nodes.length === 1 ? '' : 's'}</span>
      <a href="${esc(graph.map.url)}" target="_blank" rel="noreferrer noopener">on GitHub ↗</a>
      <button class="close" data-close title="close the dock">×</button>
    </div></div><div class="pb">`;

  if (!sections.length) {
    html += `<p class="empty-line">This map's body has no sections beyond its destination.</p>`;
  }

  for (const s of sections) {
    const collapsed = s.key === 'decisionsSoFar';
    const count = s.items.length ? `<span class="count">· ${s.items.length} item${s.items.length === 1 ? '' : 's'}</span>` : '';
    html += `<section class="sect${collapsed ? ' folded' : ''}" data-sect="${esc(s.key ?? s.title)}">
      <p class="lbl tog" data-fold>${esc(s.title)} ${count}</p>
      <div class="body">${md(s.markdown, { link })}</div>
    </section>`;
  }
  // The footer is never rendered: 7 of 20 maps end in an explanation of the tracker,
  // written for someone reading raw markdown on GitHub. The dashboard *is* that
  // explanation, and a naive split files it as a scope ruling.

  scroller.innerHTML = html + '</div>';
  wire(scroller, graph, { onSelect, onHover });
  setStop(scroller);
  restoreScroll(scroller, 'map');
  syncRail(scroller.parentElement, scroller);
}

// ------------------------------------------------------------------ the ticket panel

/**
 * One ticket: the question, then its dependencies **by name**, then the whole thread in
 * order. The layout is uniform across statuses — an open ticket's question and its inbound
 * constraints are as worth reading as a resolved one's answer, and six status-specific
 * layouts would be six things to keep consistent for a difference the data already
 * expresses.
 */
export function renderTicketPanel(graph, node, scroller, { onSelect, onHover, newComments = 0, onLoadNew } = {}) {
  const link = ticketLinker(graph);
  const rel = (dir) =>
    (graph.edges ?? [])
      .filter((e) => (dir === 'up' ? e.blocked === node.number : e.blocker === node.number))
      .map((e) => graph.nodes.find((n) => n.number === (dir === 'up' ? e.blocker : e.blocked)))
      .filter(Boolean);

  let html = `<div class="ph">
    <h2>${esc(node.title)}</h2>
    <div class="m">
      <span class="pill" style="color:${STATUS_COLOR[node.status]}">${esc(node.status)}</span>
      <span class="pill" style="color:#8b949e">${TYPE_GLYPH[node.type] ?? '·'} ${esc(node.type ?? 'untyped')}</span>
      <span>rank ${node.rank}</span>
      ${node.assignee ? `<span>@${esc(node.assignee)}</span>` : ''}
      <a href="${esc(node.url)}" target="_blank" rel="noreferrer noopener">#${node.number} ↗</a>
      <button class="close" data-close title="close the dock">×</button>
    </div></div><div class="pb">`;

  // With the dock open the deepest map renders at 38%, where a blocker's title is ~4.4px.
  // The drawing carries the topology; the panel carries the names.
  for (const [dir, label] of [
    ['up', 'Blocked by'],
    ['down', 'Blocks'],
  ]) {
    const list = rel(dir);
    if (!list.length) continue;
    html += `<p class="lbl">${label}</p>` +
      list
        .map(
          (m) => `<div class="dep${DONE(m) ? ' done' : ''}" data-goto="${m.number}">
            <span class="pill" style="color:${STATUS_COLOR[m.status]}">${esc(m.status)}</span>
            <span class="t">#${m.number} ${esc(m.title)}</span></div>`,
        )
        .join('');
  }

  const question = String(node.body ?? '').replace(/^Part of #\d+\s*/i, '').trim();
  html += `<p class="lbl">The question</p>`;
  html += question
    ? `<div class="body">${md(question, { link })}</div>`
    : `<p class="empty-line">Nothing has been recorded as the question.</p>`;

  const comments = node.comments ?? [];
  if (!comments.length) {
    html += `<p class="lbl">Thread</p><p class="empty-line">Nothing has been recorded on this ticket.</p>`;
  }
  comments.forEach((c) => {
    const kind = commentKind(c);
    // `archival` is the one shape that is definitionally not about the ticket — a
    // repo-wide administrative note — so it renders collapsed, one click from open.
    // Nothing else is promoted or demoted: the label is a visible guess, never a choice.
    const folded = kind === 'archival';
    html += `<div class="cmt${folded ? ' folded' : ''}">
      <div class="chead"><span class="kind ${kind}">${kind}</span>
        <span>@${esc(c.author ?? 'unknown')} · ${day(c.createdAt)} · ${kb(c.body ?? '')}</span>
        <span class="fold" data-fold>${folded ? 'show' : 'hide'}</span></div>
      <div class="body">${md(c.body ?? '', { link })}</div></div>`;
  });

  // The selected ticket never re-renders under the reader. Scroll, expansions and text
  // selection survive; the new prose is one click away.
  if (newComments > 0) {
    html += `<button class="marker" data-load-new>${newComments} new comment${newComments === 1 ? '' : 's'} — click to load</button>`;
  }

  scroller.innerHTML = html + '</div>';
  wire(scroller, graph, { onSelect, onHover, onLoadNew });
  setStop(scroller);
  if (lastTicket !== node.number) {
    scrollMemory.set('ticket', 0);
    lastTicket = node.number;
  }
  restoreScroll(scroller, 'ticket');
  syncRail(scroller.parentElement, scroller);
}

/**
 * The selected ticket's own content changed. The panel is **not** re-rendered: an inline
 * marker is appended to the DOM that is already there.
 *
 * Re-rendering would keep the scroll position (it is restored) and lose everything else —
 * every expansion the reader opened, and any live text selection mid-copy. The whole
 * reason this marker exists is that a multi-minute read must survive the poll under it, so
 * the marker is placed by mutation rather than by redraw.
 */
export function markNewComments(scroller, count, onLoad) {
  const body = scroller.querySelector('.pb');
  if (!body) return;
  let marker = body.querySelector('[data-load-new]');
  if (!marker) {
    marker = document.createElement('button');
    marker.className = 'marker';
    marker.setAttribute('data-load-new', '');
    marker.addEventListener('click', () => onLoad?.());
    body.appendChild(marker);
  }
  marker.textContent = `${count} new comment${count === 1 ? '' : 's'} — click to load`;
}

/** The panel a poll leaves behind when the ticket it was showing is gone from the map. */
export function renderVanishedPanel(number, scroller) {
  scroller.innerHTML = `<div class="ph"><h2>#${number} is no longer on this map</h2>
    <div class="m"><span>it was closed as not-a-sub-issue, moved, or deleted</span></div></div>
    <div class="pb"><p class="empty-line">The panel is kept rather than closed, so your place
    and the URL are not rewritten under you. Press <b>esc</b> for the map.</p></div>`;
  syncRail(scroller.parentElement, scroller);
}

/**
 * The scroll rail — position, extent and direct seeking, visible at rest.
 *
 * ADR 0009 chose `::-webkit-scrollbar` for this and built this rail as the alternative it
 * rejected. Measured on today's Chrome the CSS route reserves no space and paints nothing,
 * so the rejected half is what ships; its own Consequences named it as the fallback. It
 * appears only when the content overflows, which is what keeps the gutter at 0 on the
 * panels that fit.
 */
export function syncRail(dock, scroller) {
  const rail = dock.querySelector('#rail');
  const thumb = dock.querySelector('#thumb');
  if (!rail || !thumb) return;
  const overflows = scroller.scrollHeight > scroller.clientHeight + 1;
  dock.classList.toggle('overflowing', overflows);
  if (!overflows) return;
  const track = rail.clientHeight;
  const height = Math.max(24, (scroller.clientHeight / scroller.scrollHeight) * track);
  const span = scroller.scrollHeight - scroller.clientHeight;
  const top = span > 0 ? (scroller.scrollTop / span) * (track - height) : 0;
  thumb.style.height = `${height}px`;
  thumb.style.top = `${top}px`;
}

/** Dragging the thumb seeks, which is half of what a real scrollbar is for. */
export function wireRail(dock, scroller) {
  const rail = dock.querySelector('#rail');
  const thumb = dock.querySelector('#thumb');
  if (!rail || !thumb) return;
  const seekTo = (clientY, grab) => {
    const track = rail.getBoundingClientRect();
    const height = thumb.getBoundingClientRect().height;
    const y = clientY - track.top - grab;
    const span = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTop = Math.max(0, Math.min(1, y / Math.max(1, track.height - height))) * span;
  };
  thumb.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const grab = e.clientY - thumb.getBoundingClientRect().top;
    thumb.classList.add('dragging');
    const move = (ev) => seekTo(ev.clientY, grab);
    const up = () => {
      thumb.classList.remove('dragging');
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  });
  // Clicking the track jumps, as a scrollbar does.
  rail.addEventListener('mousedown', (e) => {
    if (e.target === thumb) return;
    seekTo(e.clientY, thumb.getBoundingClientRect().height / 2);
  });
  scroller.addEventListener('scroll', () => syncRail(dock, scroller), { passive: true });
}

function wire(scroller, graph, { onSelect, onHover, onLoadNew } = {}) {
  scroller.querySelectorAll('[data-goto]').forEach((e) => {
    e.addEventListener('click', (ev) => {
      ev.preventDefault();
      onSelect?.(Number(e.dataset.goto));
    });
    e.addEventListener('mouseenter', () => onHover?.(Number(e.dataset.goto)));
    e.addEventListener('mouseleave', () => onHover?.(null));
  });
  // A sticky label is also a toggle. Per-section folding stays one click away, and is not
  // the default: folding everything was measured, works, and converts the surface that
  // exists to show prose into a table of contents.
  scroller.querySelectorAll('[data-fold]').forEach((e) => {
    e.addEventListener('click', () => {
      const box = e.closest('.sect, .cmt');
      if (!box) return;
      const folded = box.classList.toggle('folded');
      if (e.classList.contains('fold')) e.textContent = folded ? 'show' : 'hide';
    });
  });
  scroller.querySelector('[data-load-new]')?.addEventListener('click', () => onLoadNew?.());
}
