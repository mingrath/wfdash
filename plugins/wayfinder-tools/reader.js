// The Reader — the one function turning GitHub into a Graph.
//
// It shells out to `gh` from the server, so it inherits the dev's existing auth and no
// token ever reaches the browser. It owns status derivation, `rank`, map-body parsing and
// the cycle throw; it owns no layout, no positions and no presentation.
//
// The two GraphQL documents live in `harness/queries.js` rather than here, and that is
// deliberate: the fixtures are recordings of *those exact strings*. `record.js` sends
// them, the fixture `gh` answers them, and `drift.js` re-sends them against the live
// corpus. One copy, three consumers, plus this one — so the day a query is edited, every
// recording it invalidates is reported rather than silently replayed.

import { execFile } from 'node:child_process';
import { MAP_QUERY, OVERVIEW_QUERY, QUERIES, ghArgs, overviewSearch } from './harness/queries.js';

/**
 * Everything the request boundary renders in the page rather than dying over.
 * `kind` is the closed vocabulary ADR 0002 fixed: a page that meets an unlisted kind is a
 * page whose hint is wrong, so new failures are named here or not at all.
 */
export class ReaderError extends Error {
  constructor(kind, message, hint) {
    super(message);
    this.name = 'ReaderError';
    this.kind = kind;
    this.hint = hint;
  }
  /** The wire shape. ADR 0002: HTTP 200 carrying `{ error: { kind, message, hint } }`. */
  toJSON() {
    return { kind: this.kind, message: this.message, hint: this.hint };
  }
}

const HINTS = {
  auth: 'run `gh auth login`',
  'not-found': 'check the owner, repo and issue number',
  'not-a-map': 'a map is an issue labelled `wayfinder:map`',
  'rate-limit': 'an agent session is probably hammering `gh` — the dashboard backs off so it can finish',
  cycle: 'two tickets block each other; unwire one of them on GitHub',
  'gh-failed': 'check `gh auth status` and your connection',
};

const fail = (kind, message, hint) => {
  throw new ReaderError(kind, message, hint ?? HINTS[kind]);
};

// ------------------------------------------------------------------ shelling out

/**
 * Run `gh` and hand back its stdout.
 *
 * There is deliberately no way to substitute the command. "The Reader shells out to `gh`"
 * *is* the contract, so the seam is the process boundary: a test puts a fixture `gh` first
 * on the child's PATH and this function never learns it is under test. An injectable
 * runner would be a second, weaker seam maintained for nobody.
 *
 * `maxBuffer` is large because a map recording is 2.7MB of bodies and comments — the whole
 * point of the contract being inline — and the default 1MB truncates it into a JSON parse
 * error that reads like GitHub returning garbage.
 */
export function runGh(args, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: 1 << 28, timeout: timeoutMs, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = String(stdout ?? '');
        err.stderr = String(stderr ?? '');
        return reject(err);
      }
      resolve(String(stdout));
    });
  });
}

const looksUnauthenticated = (text) =>
  /gh auth login|not logged (in)?to|authentication|bad credentials|requires authentication|HTTP 401/i.test(text);
const looksRateLimited = (text) => /RATE_LIMITED|rate limit|secondary rate|abuse detection/i.test(text);
const looksMissing = (text) => /NOT_FOUND|could not resolve to a|HTTP 404/i.test(text);

/**
 * One GraphQL request, and every way it can fail turned into a `ReaderError`.
 *
 * `gh` exits non-zero on a GraphQL error *and still prints the body*, so stdout is parsed
 * before the exit code is believed — a `NOT_FOUND` reply carries a usable `errors[]` that
 * says which of the closed kinds it is, and the exit code alone cannot.
 */
export async function graphql(query, variables, varTypes) {
  const args = ghArgs(query, variables, varTypes);
  let stdout;
  let stderr = '';
  try {
    stdout = await runGh(args);
  } catch (e) {
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? String(e.message ?? '');
  }

  let payload = null;
  if (stdout.trim()) {
    try {
      payload = JSON.parse(stdout);
    } catch {
      payload = null;
    }
  }

  if (!payload) {
    // `gh` died before it wrote anything parseable. An empty reply is a real thing it does.
    const text = stderr || 'gh produced no output';
    if (looksUnauthenticated(text)) fail('auth', text.trim().slice(0, 300));
    if (looksRateLimited(text)) fail('rate-limit', text.trim().slice(0, 300));
    fail('gh-failed', text.trim().slice(0, 300));
  }

  const errors = payload.errors ?? [];
  if (errors.length) {
    const text = errors.map((e) => e.message ?? e.type ?? '').join('; ');
    const types = errors.map((e) => e.type ?? '').join(' ');
    if (looksRateLimited(types + ' ' + text)) {
      fail('rate-limit', text.slice(0, 300), rateLimitHint(payload));
    }
    if (looksUnauthenticated(types + ' ' + text)) fail('auth', text.slice(0, 300));
    if (looksMissing(types + ' ' + text)) fail('not-found', text.slice(0, 300));
    // A GraphQL error that still carried usable data is not fatal; one that did not, is.
    if (!payload.data) fail('gh-failed', text.slice(0, 300));
  }
  if (!payload.data) fail('gh-failed', 'gh returned no data');
  return payload.data;
}

const rateLimitHint = (payload) => {
  const reset = payload?.data?.rateLimit?.resetAt;
  return reset ? `resets at ${reset}` : HINTS['rate-limit'];
};

/**
 * The startup check, and the per-request one. A token can be revoked at hour three, so the
 * startup check is fast-fail convenience rather than the only guard.
 */
export async function checkAuth() {
  try {
    await runGh(['auth', 'status'], { timeoutMs: 10000 });
    return true;
  } catch (e) {
    const text = e.stderr || e.stdout || String(e.message ?? '');
    if (e.code === 'ENOENT') {
      fail('auth', '`gh` is not installed or not on PATH', 'install the GitHub CLI: https://cli.github.com');
    }
    fail('auth', String(text).trim().slice(0, 300) || 'gh auth status failed');
  }
}

// ------------------------------------------------------------------ status and rank

/** The six statuses, first match wins. One vocabulary, shared with the overview's counts. */
export function statusOf(sub) {
  if (sub.state !== 'OPEN') return sub.stateReason === 'NOT_PLANNED' ? 'out-of-scope' : 'resolved';
  if (sub.stateReason === 'REOPENED') return 'undermined';
  // `blockedBy` returns CLOSED blockers too, so `totalCount` reports finished maps as
  // blocked. At least one OPEN blocker, or nothing.
  if ((sub.blockedBy?.nodes ?? []).some((b) => b.state === 'OPEN')) return 'blocked';
  if ((sub.assignees?.totalCount ?? sub.assignees?.nodes?.length ?? 0) > 0) return 'claimed';
  return 'frontier';
}

/** The `counts` key a status lands in. The wire keys are camelCase; the statuses are not. */
export const COUNT_KEY = {
  resolved: 'resolved',
  'out-of-scope': 'outOfScope',
  undermined: 'undermined',
  blocked: 'blocked',
  claimed: 'claimed',
  frontier: 'frontier',
};

export const emptyCounts = () => ({ resolved: 0, outOfScope: 0, undermined: 0, blocked: 0, claimed: 0, frontier: 0 });

/**
 * Longest path: 0 without blockers, else one past the deepest blocker, so blockers always
 * lay out before what they block. Graph math, not layout — the page decides positions.
 *
 * Iterative rather than recursive, because a map is user-supplied and a deep chain should
 * not be a stack overflow. A cycle throws; the request boundary catches it and the page
 * renders it.
 */
export function rankAll(nodes, edges) {
  const up = new Map(nodes.map((n) => [n.number, []]));
  for (const e of edges) if (up.has(e.blocked) && up.has(e.blocker)) up.get(e.blocked).push(e.blocker);

  const rank = new Map();
  const WHITE = 0, GREY = 1, BLACK = 2;
  const mark = new Map(nodes.map((n) => [n.number, WHITE]));

  for (const start of up.keys()) {
    if (mark.get(start) !== WHITE) continue;
    const stack = [{ n: start, i: 0 }];
    mark.set(start, GREY);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const parents = up.get(frame.n);
      if (frame.i < parents.length) {
        const p = parents[frame.i++];
        const state = mark.get(p);
        if (state === GREY) fail('cycle', `dependency cycle through #${p}`);
        if (state === WHITE) {
          mark.set(p, GREY);
          stack.push({ n: p, i: 0 });
        }
      } else {
        stack.pop();
        mark.set(frame.n, BLACK);
        rank.set(frame.n, parents.length ? Math.max(...parents.map((p) => rank.get(p))) + 1 : 0);
      }
    }
  }
  for (const n of nodes) n.rank = rank.get(n.number) ?? 0;
  return nodes;
}

// ------------------------------------------------------------------ map body parsing

const CANONICAL = {
  destination: 'destination',
  notes: 'notes',
  'decisions so far': 'decisionsSoFar',
  'not yet specified': 'notYetSpecified',
  'out of scope': 'outOfScope',
};

/**
 * A heading's canonical form: lowercased, separators collapsed to one space.
 *
 * This is exact matching modulo separator, not fuzzy matching. `Decisions so far` and
 * `Decisions-so-far` are the same heading written two ways and both occur; `Glossary` is
 * neither, and no amount of normalising makes it one. Fuzzy title matching is what is
 * ruled out — at 22/22 exact it can only manufacture false positives — and edit distance,
 * substring and prefix matching are all absent by construction.
 */
const canonicalKey = (title) => CANONICAL[title.toLowerCase().replace(/[\s\-_]+/g, ' ').trim()] ?? null;

/** The tracker boilerplate 35% of maps end in, written for someone reading raw markdown. */
const FOOTER_RE = /(?:^|\n)-{3,}\s*\n+((?:\s*(?:\*|_|🗺️|>).*\n?)+)\s*$/;

/**
 * Split a map body on every `##`, in document order, skipping fenced regions.
 *
 * A missing section is an absent key, never an error, and anything not one of the
 * canonical five survives with `key: null` — all the extras in the corpus are ticket
 * indexes a human maintains by hand.
 */
export function parseMapBody(body) {
  const text = String(body ?? '').replace(/\r\n?/g, '\n');

  let rest = text;
  let footer = null;
  const m = FOOTER_RE.exec(text);
  if (m) {
    footer = m[1].trim();
    rest = text.slice(0, m.index);
  }

  const lines = rest.split('\n');
  const sections = [];
  let fence = null;
  let current = null;
  const flush = () => {
    if (!current) return;
    const markdown = current.lines.join('\n').trim();
    sections.push({
      title: current.title,
      key: canonicalKey(current.title),
      markdown,
      items: bulletItems(markdown),
    });
  };

  for (const line of lines) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      // Only a fence of at least the opening length closes it, so a ```` block containing
      // ``` survives — which is what a map documenting its own markdown writes.
      if (!fence) fence = f[1];
      else if (line.trim().startsWith(fence[0].repeat(fence.length))) fence = null;
      if (current) current.lines.push(line);
      continue;
    }
    if (!fence) {
      const h = /^##\s+(.+?)\s*$/.exec(line);
      if (h) {
        flush();
        current = { title: h[1], lines: [] };
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  flush();

  const destination = sections.find((s) => s.key === 'destination')?.markdown ?? null;
  return { destination, sections, footer };
}

/** A flat array of the section's top-level bullets. Empty when the section is prose. */
function bulletItems(markdown) {
  const items = [];
  let fence = null;
  let open = null;
  for (const line of markdown.split('\n')) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (line.trim().startsWith(fence[0].repeat(fence.length))) fence = null;
      if (open) open.push(line);
      continue;
    }
    if (fence) {
      if (open) open.push(line);
      continue;
    }
    const bullet = /^\s{0,3}(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      if (open) items.push(open.join('\n').trim());
      open = [bullet[1]];
      continue;
    }
    if (open) {
      if (/^\s*$/.test(line)) open.push('');
      else if (/^\s+\S/.test(line)) open.push(line.trim());
      else {
        items.push(open.join('\n').trim());
        open = null;
      }
    }
  }
  if (open) items.push(open.join('\n').trim());
  return items.filter(Boolean);
}

// ------------------------------------------------------------------ truncation

/**
 * Silent truncation is designed out, not priced around: cost bills on the requested
 * `first:`, not on results, so the guard is free and the failure it catches — an
 * 18-blocker ticket reclassified as takeable — is not.
 */
const truncCheck = (out, where, conn) => {
  if (!conn) return;
  const have = conn.nodes?.length ?? 0;
  const total = conn.totalCount;
  if (typeof total === 'number' && total > have) out.push({ where, have, total });
};

// ------------------------------------------------------------------ the map route

/**
 * One map and every sub-issue, as the graph contract. Everything inline — no lazy
 * endpoint, no second round trip, one code path — which is what makes the detail panel
 * open instantly.
 */
export async function readGraph({ owner, repo, number }) {
  const data = await graphql(MAP_QUERY, { o: owner, r: repo, n: Number(number) }, QUERIES.MAP_QUERY.vars);
  return buildGraph(data, { owner, repo, number });
}

/** The pure half of `readGraph`: a recorded response in, a graph contract out. */
export function buildGraph(data, { owner, repo, number } = {}) {
  const repository = data.repository;
  if (!repository) fail('not-found', `no repository ${owner}/${repo}`);
  const issue = repository.issue;
  if (!issue) fail('not-found', `${repository.nameWithOwner ?? `${owner}/${repo}`} has no issue #${number}`);

  const labels = (issue.labels?.nodes ?? []).map((l) => l.name);
  if (!labels.includes('wayfinder:map')) {
    fail('not-a-map', `#${issue.number} "${issue.title}" is not labelled wayfinder:map`);
  }

  const truncated = [];
  truncCheck(truncated, 'subIssues', issue.subIssues);

  const subs = issue.subIssues?.nodes ?? [];
  const nodes = subs.map((s) => {
    truncCheck(truncated, `#${s.number}.blockedBy`, s.blockedBy);
    truncCheck(truncated, `#${s.number}.comments`, s.comments);
    truncCheck(truncated, `#${s.number}.labels`, s.labels);
    truncCheck(truncated, `#${s.number}.assignees`, s.assignees);
    const assignee = s.assignees?.nodes?.[0]?.login ?? null;
    return {
      number: s.number,
      title: s.title,
      type: (s.labels?.nodes ?? []).map((l) => l.name).find((n) => n.startsWith('wayfinder:'))?.slice('wayfinder:'.length) ?? null,
      status: statusOf(s),
      assignee,
      // The last ASSIGNED_EVENT, and null when nobody holds it — a stale event from a
      // claim that was handed back is not a claim.
      claimedAt: assignee ? (s.timelineItems?.nodes ?? []).at(-1)?.createdAt ?? null : null,
      rank: 0,
      url: s.url,
      body: s.body ?? '',
      comments: (s.comments?.nodes ?? []).map((c) => ({
        author: c.author?.login ?? null,
        createdAt: c.createdAt,
        body: c.body ?? '',
      })),
    };
  });

  // Edges include closed blockers, because a resolved dependency is still worth drawing.
  // No `satisfied` flag: an edge is cleared iff its blocker's status is resolved or
  // out-of-scope, and storing that duplicates state a refresh would stale.
  const present = new Set(nodes.map((n) => n.number));
  const edges = [];
  for (const s of subs) {
    for (const b of s.blockedBy?.nodes ?? []) {
      if (present.has(b.number) && b.number !== s.number) edges.push({ blocker: b.number, blocked: s.number });
    }
  }

  rankAll(nodes, edges);

  const { destination, sections, footer } = parseMapBody(issue.body);
  return {
    repo: repository.nameWithOwner ?? `${owner}/${repo}`,
    map: {
      number: issue.number,
      title: issue.title,
      url: issue.url,
      destination,
      body: issue.body ?? '',
      sections,
      footer,
    },
    nodes,
    edges,
    truncated,
    rateLimit: data.rateLimit ?? null,
  };
}

// ------------------------------------------------------------------ the overview

/**
 * Whoever `gh` is authenticated as, asked once per process.
 *
 * The overview has to name an owner to search, and the only honest answer is the account
 * whose credentials the Reader is already borrowing. Baking a login into the source makes
 * the overview correct for exactly one person and silently empty for everybody else.
 *
 * A rejection is not cached: a token can be fixed at hour three without restarting.
 */
let loginPromise = null;
export async function viewerLogin() {
  loginPromise ??= runGh(['api', 'user', '--jq', '.login'], { timeoutMs: 10000 }).then(
    (out) => {
      const login = out.trim();
      if (!login) fail('gh-failed', '`gh api user` returned no login');
      return login;
    },
    (e) => {
      loginPromise = null;
      const text = e.stderr || e.stdout || String(e.message ?? '');
      if (e.code === 'ENOENT') {
        fail('auth', '`gh` is not installed or not on PATH', 'install the GitHub CLI: https://cli.github.com');
      }
      if (looksUnauthenticated(text)) fail('auth', text.trim().slice(0, 300));
      if (looksRateLimited(text)) fail('rate-limit', text.trim().slice(0, 300));
      fail('gh-failed', `could not read the logged-in account: ${text.trim().slice(0, 200)}`);
    },
  );
  return loginPromise;
}

/**
 * Every open wayfinder map you can see, as six integers each. A different, smaller shape —
 * not an array of graphs. A ticket is deliberately not reachable from a card.
 *
 * The default expression names the authenticated account, so the page is right on the first
 * run for whoever installed it. `WFDASH_SEARCH` overrides it, and that is not a convenience:
 * `user:` was measured to **silently omit org and collaborator repos**, so an account whose
 * maps do not all live under one user has no other way to see them, and a search that
 * quietly returns a subset is the one failure this route cannot detect for itself.
 */
export async function readOverview({ search } = {}) {
  const q = search || process.env.WFDASH_SEARCH || overviewSearch(await viewerLogin());
  const data = await graphql(OVERVIEW_QUERY, { q }, QUERIES.OVERVIEW_QUERY.vars);
  return buildOverview(data);
}

/** The pure half of `readOverview`. */
export function buildOverview(data) {
  const search = data.search ?? { nodes: [] };
  const truncated = [];
  const have = search.nodes?.length ?? 0;
  if (typeof search.issueCount === 'number' && search.issueCount > have) {
    truncated.push({ where: 'search', have, total: search.issueCount });
  }
  if (search.pageInfo?.hasNextPage) truncated.push({ where: 'search.pageInfo', have, total: have + 1 });

  const maps = (search.nodes ?? []).map((m) => {
    truncCheck(truncated, `${m.repository?.nameWithOwner}#${m.number}.subIssues`, m.subIssues);
    const counts = emptyCounts();
    for (const s of m.subIssues?.nodes ?? []) {
      truncCheck(truncated, `${m.repository?.nameWithOwner}#${m.number}/#${s.number}.blockedBy`, s.blockedBy);
      counts[COUNT_KEY[statusOf(s)]]++;
    }
    return {
      repo: m.repository?.nameWithOwner ?? '',
      number: m.number,
      title: m.title,
      url: m.url,
      updatedAt: m.updatedAt,
      counts,
    };
  });

  return { maps, truncated, rateLimit: data.rateLimit ?? null };
}
