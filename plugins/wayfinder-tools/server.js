// The Server — one local Node process, no dependencies, no build step.
//
// It serves the page, exposes the read-only API, holds the TTL cache and the idle timer,
// and holds **no current-map state**: every request names its own target, which is what
// lets `/m/*` be one catch-all serving the same bytes for every map.
//
// There are zero write endpoints. Not "nearly zero" — `/wfdash stop` reads a pid from
// `/api/health` and kills the process, precisely so that no route can mutate anything.
//
//   node server.js [--port 7777]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGraph, readOverview, checkAuth, ReaderError } from './reader.js';
import { occupantOf, takenMessage } from './port.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_DIR = join(HERE, 'page');

export const DEFAULT_PORT = 7777;
/** ADR 0012's poll interval. The cache TTL and the interval are one number by design. */
export const OVERVIEW_TTL_MS = 120_000;
/** ADR 0002. Coupled to the page's 10-minute heartbeat; the two move together. */
export const IDLE_MS = 30 * 60_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

const sendJSON = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

/**
 * ADR 0002: everything but a missing or unauthenticated `gh` renders *in the page*.
 * HTTP 200 carrying `{ error: { kind, message, hint } }` — killing the process over a
 * mistyped repo name is absurd, and a non-200 would make the page's own failure path
 * (server dead vs GitHub refused) unable to tell them apart.
 */
const sendError = (res, e) => {
  const err =
    e instanceof ReaderError
      ? e.toJSON()
      : { kind: 'gh-failed', message: String(e?.message ?? e).slice(0, 300), hint: 'check `gh auth status`' };
  sendJSON(res, 200, { error: err });
};

export async function createWfdashServer({ port = DEFAULT_PORT, ttlMs = OVERVIEW_TTL_MS, idleMs = IDLE_MS } = {}) {
  const startedAt = new Date().toISOString();
  const serverMtime = await stat(join(HERE, 'server.js'))
    .then((s) => s.mtimeMs)
    .catch(() => 0);

  // Everything the server remembers. None of it is about a *map* — it is the cache, the
  // idle timer, and what the last poll actually cost.
  const state = {
    overview: null, // { at, value, inflight }
    lastPoll: null, // { route, cost, remaining, resetAt, at, ms }
    sessionCost: 0,
    polls: 0,
    authCheckedAt: 0,
  };

  let idleTimer = null;
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // Nothing has asked for thirty minutes. Forgetting to stop costs nothing, and the
      // next `/wfdash` simply starts one — detection is a probe, so a reaped server is
      // indistinguishable from one that never ran.
      process.exit(0);
    }, idleMs);
    idleTimer.unref?.();
  };

  /**
   * Auth is checked per request as well as at startup, because a token can be revoked at
   * hour three. Memoised for a minute so a 15-second poll does not pay for a subprocess
   * it already paid for — the query itself still fails with `kind: "auth"` instantly if
   * the token dies inside the window, so the memo shortens no guarantee.
   */
  const ensureAuth = async () => {
    if (Date.now() - state.authCheckedAt < 60_000) return;
    await checkAuth();
    state.authCheckedAt = Date.now();
  };

  /** Sum cost off each response. Never difference `remaining` — it refills on the hour. */
  const recordCost = (route, payload, ms) => {
    state.polls++;
    const rl = payload?.rateLimit;
    if (rl && typeof rl.cost === 'number') state.sessionCost += rl.cost;
    state.lastPoll = {
      route,
      cost: rl?.cost ?? null,
      remaining: rl?.remaining ?? null,
      resetAt: rl?.resetAt ?? null,
      at: new Date().toISOString(),
      ms,
    };
    return payload;
  };

  /**
   * The overview's TTL cache. Not load-bearing for multi-tab arithmetic — hidden tabs do
   * not poll — but it collapses the load-time stampede and serves concurrent sessions,
   * and it is the first thing on this route the server does rather than the page.
   */
  const cachedOverview = async () => {
    const hit = state.overview;
    if (hit?.value && Date.now() - hit.at < ttlMs) {
      return { ...hit.value, cache: 'hit', ageS: Math.round((Date.now() - hit.at) / 1000) };
    }
    if (hit?.inflight) return hit.inflight;
    const t0 = Date.now();
    const p = readOverview()
      .then((value) => {
        recordCost('overview', value, Date.now() - t0);
        state.overview = { at: Date.now(), value };
        return { ...value, cache: 'miss', ageS: 0 };
      })
      .catch((e) => {
        state.overview = null;
        throw e;
      });
    state.overview = { ...(hit ?? {}), inflight: p };
    return p;
  };

  const servePage = async (res) => {
    const html = await readFile(join(PAGE_DIR, 'index.html'));
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
    res.end(html);
  };

  const serveAsset = async (res, pathname) => {
    // `normalize` then reject anything that climbed out: the page directory is the whole
    // of what this process is willing to read from disk.
    const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(PAGE_DIR, rel);
    if (!file.startsWith(PAGE_DIR)) {
      res.writeHead(403).end('no');
      return;
    }
    try {
      await stat(file);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  };

  const server = createServer(async (req, res) => {
    touch();
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    try {
      if (p === '/api/health') {
        return sendJSON(res, 200, {
          app: 'wfdash',
          pid: process.pid,
          startedAt,
          serverMtime,
          polls: state.polls,
          sessionCost: state.sessionCost,
          lastPoll: state.lastPoll,
        });
      }

      if (p === '/api/overview') {
        await ensureAuth();
        return sendJSON(res, 200, await cachedOverview());
      }

      if (p === '/api/graph') {
        await ensureAuth();
        const repo = url.searchParams.get('repo') ?? '';
        const [owner, name] = repo.split('/');
        const number = url.searchParams.get('n');
        if (!owner || !name || !number) {
          return sendError(res, new ReaderError('not-found', `bad target ${JSON.stringify(repo + '#' + number)}`, 'the shape is /m/<owner>/<repo>/<number>'));
        }
        const t0 = Date.now();
        const graph = await readGraph({ owner, repo: name, number });
        recordCost('map', graph, Date.now() - t0);
        return sendJSON(res, 200, graph);
      }

      // `/` is the overview and `/m/*` is a map view, and both are the same bytes: a
      // pasted deep link or a hard reload arrives here as a real path, and serving one
      // page for all of them is what keeps "no current-map state" true.
      if (p === '/' || p === '/m' || p.startsWith('/m/')) return await servePage(res);

      return await serveAsset(res, p);
    } catch (e) {
      sendError(res, e);
    }
  });

  return {
    server,
    state,
    startedAt,
    serverMtime,
    /** Resolves to the port actually bound, or rejects with a named occupant on collision. */
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', async (e) => {
          if (e.code === 'EADDRINUSE') {
            const who = await occupantOf(port);
            const err = new Error(takenMessage(port, who));
            err.code = 'EADDRINUSE';
            err.occupant = who;
            return reject(err);
          }
          reject(e);
        });
        server.listen(port, '127.0.0.1', () => {
          touch();
          resolve(server.address().port);
        });
      });
    },
    close() {
      clearTimeout(idleTimer);
      return new Promise((r) => server.close(r));
    },
  };
}

// ------------------------------------------------------------------ as a process

// The only argument is the port, and the only reason it exists is `WFDASH_PORT`. The idle
// timeout and the cache TTL are **not** flags: ADR 0002 fixes the reap at thirty minutes
// and ADR 0005 couples it to the page's ten-minute heartbeat, so a flag that moves one
// without the other is a way to break the pair. A test that needs a shorter timer calls
// `createWfdashServer` from its own entry point rather than asking this one for a knob.
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const argPort = process.argv.indexOf('--port');
  const port = Number(argPort > 0 ? process.argv[argPort + 1] : process.env.WFDASH_PORT || DEFAULT_PORT);
  const wfdash = await createWfdashServer({ port });
  try {
    const bound = await wfdash.listen();
    process.stdout.write(`wfdash server  pid ${process.pid}  http://127.0.0.1:${bound}/\n`);
  } catch (e) {
    process.stderr.write(`wfdash: ${e.message}\n`);
    process.exit(1);
  }
}
