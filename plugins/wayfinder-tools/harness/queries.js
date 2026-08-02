// The two GraphQL documents the Reader will send, and the one function that turns a
// request into a fixture key.
//
// They live here rather than beside the Reader because the fixtures are *recordings of
// these exact strings*: `record.js` sends them, `gh` (the fixture binary) answers them,
// and `drift.js` re-sends them against the live corpus. One copy, three consumers. When
// ticket #29 builds the Reader it imports from here; the day it edits a query, every
// recording it invalidates is reported by `drift.js` rather than silently replayed.
//
// Costs are measured, never quoted. Cost bills on the requested `first:`, not on results,
// so the `first:` numbers below are load-bearing and must not be tuned without re-reading
// `rateLimit { cost }` off the response.
//
// Measured on this corpus, 2026-07-31: **overview 30** as the spec says, and **map 5** —
// not the 4 the spec says. The difference is `timelineItems`. Every published measurement
// of 4 was taken against the live-poll prototype's query, which had no timeline in it and
// so had no `claimedAt`; adding the one connection the contract's `claimedAt` requires
// costs exactly one point. 4 was never a measurement of this query. The contract wins:
// `claimedAt` is in the graph contract, so the timeline stays and the map route costs 5.
//
// Re-measured 2026-08-01 for the overview's attendance split: **overview 60**, map still 5.
// The whole derivation is under `OVERVIEW_QUERY` — labels are +15 as #73 priced them, the
// sub-issue ceiling is what the other +15 bought, and dropping one pointless `first:` paid
// for 30 of it.

import { createHash } from 'node:crypto';

/**
 * One map and every sub-issue, with bodies and uncapped comments inline. Cost 5.
 *
 * `subIssues(first:100)` — 54 tickets of headroom over the largest map in the corpus.
 * `blockedBy(first:30)` — the corpus already holds a 20-blocker ticket, and truncating it
 *   would silently reclassify a blocked ticket as takeable.
 * `timelineItems(last:1, ASSIGNED_EVENT)` — `claimedAt`, the contract's one derived date,
 *   and the one point of difference between cost 4 and cost 5.
 * `totalCount` at every level — so truncation is comparable, never silently trusted.
 *
 * The map issue's own `labels` are here despite not appearing in the graph contract: they
 * are how `not-a-map` is derived, and an issue that is not a map produces no contract to
 * carry them in. Measured at cost 5 with and without, so they are free.
 */
export const MAP_QUERY = `query($o:String!,$r:String!,$n:Int!){
  repository(owner:$o,name:$r){ nameWithOwner issue(number:$n){
    number title url body
    labels(first:10){ totalCount nodes{name} }
    subIssues(first:100){ totalCount nodes {
      number title url body state stateReason
      labels(first:10){ totalCount nodes{name} }
      assignees(first:3){ totalCount nodes{login} }
      blockedBy(first:30){ totalCount nodes{number state} }
      comments(first:100){ totalCount nodes{author{login} createdAt body} }
      timelineItems(last:1, itemTypes:[ASSIGNED_EVENT]){ nodes{ ... on AssignedEvent { createdAt } } }
    } } } }
  rateLimit { cost remaining resetAt } }`;

/**
 * Every open wayfinder map you can see, with just enough of each sub-issue to derive the
 * six counts and the attendance split. **Cost 60**, measured 2026-08-01; it was 30.
 * No ticket identity: a card cannot reach a ticket, and buying that was priced at cost
 * 20→30 and 34KB→77KB per poll.
 *
 * The `first:` numbers here are not taste, and this query is where the overview's whole
 * budget is decided, so the arithmetic is written down rather than re-derived by the next
 * person to touch it.
 *
 * **What the cost actually bills.** Measured on the live corpus (25 maps, 316 tickets),
 * five shapes, cost read off `rateLimit.cost`:
 *
 * | shape | cost |
 * | --- | --- |
 * | `search:30 sub:50 blocked:30`, no labels — as shipped | **30** |
 * | `+ labels(first:10)` | **45** |
 * | `+ labels`, `sub:80` | **72** |
 * | `+ labels`, `sub:100` | **90** |
 * | `+ labels(first:2)`, `sub:100` | **90** |
 *
 * Those five fit one rule exactly: **cost = ⌊(1 + search + search × sub × C) / 100⌋**,
 * where `C` is the number of **paginated connections asked per sub-issue**. A connection
 * asking `first: n ≤ 100` bills one request whatever `n` is — which is why `labels(first:2)`
 * and `labels(first:10)` cost the same, and why `blockedBy(first:30)` is still free. The
 * sub-issue ceiling is the one `first:` that is *not* free: every sub-issue is multiplied by
 * `C`, so at `search: 30` each ten tickets of headroom costs `0.3 × C` points.
 * [#73](https://github.com/mingrath/wfdash-dev/issues/73) is right that trimming a `first:`
 * saves nothing — but only for the inner connections it measured. It is wrong for `sub`.
 *
 * **`assignees { totalCount }` drops the `first: 1`, and that is worth 30 points.** The
 * argument bought nothing: `totalCount` is a scalar on the connection and needs no page, so
 * `assignees(first: 1)` was paying a full request per sub-issue for a page nobody read.
 * Removing it takes `C` from 3 to 2 — measured `sub:80` 72 → 48, with the derived
 * `claimed` count identical (222 assigned tickets both ways). It is the whole reason the
 * ceiling below is affordable.
 *
 * `subIssues(first: 100)` — `MOOD-diagnosis-new#156` holds **62** and held 31 when
 * ADR 0011 raised this to 40, 36 when ADR 0012 raised it to 50. A ceiling outgrown twice
 * does not want tuning a third time, and **100 is not a choice: it is the maximum GitHub
 * accepts.** `first: 120` returns `EXCESSIVE_PAGINATION` with every map `null` — and still
 * bills 72. So this is the last time the number can move; the next map past 100 forces
 * pagination, which is a different decision.
 *
 * `labels(first: 10)` — matches `MAP_QUERY`, so `attendanceOf` and `typeOf` read the same
 * list on both routes. Free to widen and free to narrow, per the rule above.
 *
 * **The poll budget, re-run against 60** (ADR 0012 settled it at cost 30):
 * the overview at 120s spends **60 × 30 = 1800/hour, 36% of the 5000-point budget**; the map
 * route at 15s and cost 5 spends 1200. Both open is **3000/hour, 60%** — up from 42%, still
 * inside, and still far from a limit the dashboard could inflict on itself. 15 seconds here
 * would be 14,400/hour, so ADR 0012's central finding survives the re-pricing intact: this
 * route cannot be polled like the map route at any shape. What has narrowed is the room left
 * for the agent sessions doing the real work — 40% instead of 58%.
 */
export const OVERVIEW_QUERY = `query($q:String!){
  search(type: ISSUE, query: $q, first: 30) {
    issueCount
    pageInfo { hasNextPage }
    nodes { ... on Issue {
      number title url updatedAt
      repository { nameWithOwner }
      subIssues(first: 100) {
        totalCount
        nodes {
          number state stateReason
          assignees { totalCount }
          labels(first: 10) { totalCount nodes { name } }
          blockedBy(first: 30) { totalCount nodes { state } }
        }
      }
    } }
  }
  rateLimit { cost remaining resetAt }
}`;

/**
 * The search expression the overview is defined over, for one account.
 *
 * `user:` is a deliberate narrowing, not a default worth widening: dropping it returns every
 * public map on GitHub, which is somebody else's effort in somebody else's repo. The price
 * is that `user:` was measured to silently omit org and collaborator repos, which is why
 * `WFDASH_SEARCH` exists and why the README documents it rather than hiding it.
 */
export const overviewSearch = (login) => `label:"wayfinder:map" state:open user:${login}`;

/**
 * Collapse a GraphQL document to its shape — whitespace runs to one space, trimmed.
 * Two documents that differ only in indentation are the same query and must hit the same
 * recording; two that differ in a `first:` are different queries and must not.
 */
export const normalise = (query) => String(query).replace(/\s+/g, ' ').trim();

/**
 * The fixture key: a request is (document shape, variables). Variable order is not part of
 * a request, so keys are sorted before hashing, and every value is coerced to its string
 * form because that is what actually crosses the process boundary — `-F n=1` reaches the
 * fixture binary as the three characters `n=1`, and a key computed on the caller's number
 * would never match the one computed on the callee's string.
 */
export function keyOf(query, variables = {}) {
  const sorted = {};
  for (const k of Object.keys(variables).sort()) sorted[k] = String(variables[k]);
  const material = `${normalise(query)}\n${JSON.stringify(sorted)}`;
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/** The wire form of a variable set: what the manifest stores and the key is taken over. */
export const wireVars = (variables = {}) =>
  Object.fromEntries(Object.keys(variables).sort().map((k) => [k, String(variables[k])]));

/**
 * Every query with its variables' GraphQL types, by the name the manifest records.
 *
 * The types are here rather than inferred from the value because a manifest stores
 * variables in their wire form — all strings — and re-sending `n` as a string is rejected
 * by `Int!`. Inferring from `typeof` works when the caller holds live values and fails
 * silently the moment it does not, which is exactly what `drift.js` does.
 */
export const QUERIES = {
  MAP_QUERY: { document: MAP_QUERY, vars: { o: 'String', r: 'String', n: 'Int' } },
  OVERVIEW_QUERY: { document: OVERVIEW_QUERY, vars: { q: 'String' } },
};

const TYPED = new Set(['Int', 'Float', 'Boolean']);

/**
 * The argv `gh` is invoked with for a graphql request. The fixture binary parses this back.
 * `varTypes` may be a `QUERIES[…].vars` map; without one, types are inferred from the
 * values, which is only safe when the caller holds them unstringified.
 */
export function ghArgs(query, variables = {}, varTypes = null) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(variables)) {
    const typed = varTypes ? TYPED.has(varTypes[k]) : typeof v === 'number' || typeof v === 'boolean';
    args.push(typed ? '-F' : '-f', `${k}=${v}`);
  }
  return args;
}
