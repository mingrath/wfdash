// The markdown renderer — hand-rolled, zero dependencies, over what real wayfinder prose
// actually contains: headings, fences, tables, lists, blockquotes, hr and inline marks.
// Exercised over 32 real documents carrying 428 inline code spans, 250 bolds, 37 links,
// 13 fenced blocks and 3 tables — raw text is not an option at that density.
//
// Anyone can comment on a public repo, so comment prose is **untrusted input**. Markup is
// escaped before anything is inlined, and link schemes are allowlisted: `[click](javascript:…)`
// is otherwise a live hole in any renderer that writes `innerHTML`.
//
// Pure, and importable outside a browser.

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Only schemes that cannot execute. Everything else becomes an inert `#`. */
export const safeHref = (u) => (/^(https?:\/\/|mailto:|#|\/)/i.test(String(u).trim()) ? String(u).trim() : '#');

/**
 * Inline marks. Escaping happens first and exactly once, so a `<script>` in prose is text
 * and a `<b>` this function writes is markup — the two can never be confused because only
 * one of them exists after `esc`.
 */
export function inline(s, { link = null } = {}) {
  const code = [];
  // Code spans are lifted out before the other marks run, so `**` inside a code span stays
  // literal. The sentinel is a control pair — stripped from the input first, so no prose can
  // spell one. A bare-digit placeholder collides with any number written between spaces.
  let t = esc(String(s).replace(/[\x00\x01]/g, '')).replace(/`([^`]+)`/g, (m, c) => `\x00${code.push(c) - 1}\x01`);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m, text, url) => {
    const href = safeHref(url);
    const extra = link ? link(url, href) : null;
    if (extra) return `<a href="${esc(extra.href)}"${extra.attrs ?? ''}>${text}</a>`;
    return `<a href="${esc(href)}" target="_blank" rel="noreferrer noopener">${text}</a>`;
  });
  t = t
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<i>$2</i>');
  return t.replace(/\x00(\d+)\x01/g, (m, i) => `<code>${esc(code[Number(i)])}</code>`);
}

/**
 * Block structure.
 *
 * `opts.link(rawUrl, safeUrl)` may return `{ href, attrs }` to rewrite one link — that is
 * how a link pointing at a ticket on *this* map becomes a selection instead of a
 * navigation. It is a per-link rule, never a per-item one: an item naming four tickets
 * gets four working links and no claim about which one it belongs to.
 */
/**
 * What ends a paragraph. It mirrors the branch guards above exactly — `#{1,6}\s` and not a
 * bare `#`, a table row and not any `|` — so that a line this pattern rejects is always a
 * line some branch will accept.
 */
const BLOCK_START = /^\s*(#{1,6}\s|```|~~~|\||>|([-*+]|\d+[.)])\s)/;

export function md(src, opts = {}) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  let out = '';
  let i = 0;
  const row = (l, tag) =>
    '<tr>' +
    l
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => `<${tag}>${inline(c.trim(), opts)}</${tag}>`)
      .join('') +
    '</tr>';

  while (i < lines.length) {
    const l = lines[i];
    const fence = /^\s*(```+|~~~+)(.*)$/.exec(l);
    if (fence) {
      const close = fence[1];
      const buf = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${close[0]}{${close.length},}\\s*$`).test(lines[i])) buf.push(lines[i++]);
      i++;
      out += `<pre><code>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }
    if (/^\s*$/.test(l)) {
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) {
      out += '<hr>';
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      const level = Math.min(h[1].length, 3);
      out += `<h${level}>${inline(h[2], opts)}</h${level}>`;
      i++;
      continue;
    }
    if (/^\s*\|/.test(l) && /^\s*\|?[\s:|-]*\|/.test(lines[i + 1] ?? '')) {
      let t = '<table><thead>' + row(l.trim(), 'th') + '</thead><tbody>';
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) t += row(lines[i++].trim(), 'td');
      out += t + '</tbody></table>';
      continue;
    }
    if (/^\s*>/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out += `<blockquote>${md(buf.join('\n'), opts)}</blockquote>`;
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s/.test(l)) {
      const ordered = /^\s*\d+[.)]/.test(l);
      const tag = ordered ? 'ol' : 'ul';
      let t = `<${tag}>`;
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s/.test(lines[i])) {
        const buf = [lines[i++].replace(/^\s*([-*+]|\d+[.)])\s/, '')];
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) buf.push(lines[i++].trim());
        t += `<li>${inline(buf.join(' '), opts)}</li>`;
      }
      out += t + `</${tag}>`;
      continue;
    }
    // The paragraph branch is the fall-through, so it **must** consume its first line
    // unconditionally. Every other branch is guarded, and a line that looks like a block
    // but does not qualify — `#13 — who may run…` is a real comment in the corpus, a `#`
    // with no space after it, and a lone `|` with no separator row under it is another —
    // would otherwise match this loop's guard, match no branch, and never advance `i`.
    // That is an infinite loop that appends an empty paragraph until the heap goes.
    const buf = [lines[i++]];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK_START.test(lines[i])) buf.push(lines[i++]);
    out += `<p>${inline(buf.join(' '), opts)}</p>`;
  }
  return out;
}

// ------------------------------------------------------------------ comment labels

/**
 * A visible guess, never a promotion.
 *
 * A marker-based picker was audited against 15 real tickets and is wrong on 5 of 10: one
 * resolution won by 55 bytes, 4 of 7 predecessor tickets closed with no answer at all, and
 * one ticket carries an answer *plus a later amendment contradicting it* — so there is no
 * single comment that is the answer. Nothing in the wayfinder skill enforces a marker, so
 * no reader may depend on one. The labels stay because they are cheap to skim and visibly
 * guesses.
 */
const KINDS = [
  ['archival', /^\s*\*\*Archived\.?\*\*/i],
  ['amendment', /^\s*#{1,3}\s*Amendment|^\s*\*\*Amendment/i],
  ['answer', /^\s*#{1,3}\s*(Answer|Resolution)\b|^\s*\*\*(Resolved|Answer|Accepted)\b/i],
  ['inbound', /^\s*(Narrowing note|Constraint|Inbound)\b/i],
];

export const commentKind = (comment) => (KINDS.find(([, re]) => re.test(comment?.body ?? '')) ?? ['other'])[0];
