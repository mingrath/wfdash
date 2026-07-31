#!/usr/bin/env node
// The skill entry. It talks to the Server over HTTP and to the OS; it never touches GitHub.
//
//   wfdash [target]      open the dashboard — bare opens the overview
//   wfdash stop          read `pid` from /api/health and kill it
//   wfdash restart       stop, then start
//
// A target is `owner/repo#N`, `owner/repo/N`, or a GitHub issue URL.
//
// **Nothing about the running process is written to disk.** No pidfile, no port file, no
// state JSON. Anything written down is a claim about a process the writer does not
// control, and it goes stale on every reboot, every `kill -9`, every port recycle. The
// port *is* the discovery mechanism, which is why it is fixed and never scanned — a
// scanned port would have to be recorded for the next invocation to find it, reintroducing
// exactly the state file this design exists to avoid.

import { spawn, execFile } from 'node:child_process';
import { occupantOf, takenMessage } from '../port.js';
import { stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SERVER = join(ROOT, 'server.js');

const PORT = Number(process.env.WFDASH_PORT || 7777);
const BASE = `http://127.0.0.1:${PORT}`;

const out = (s) => process.stdout.write(s + '\n');
const err = (s) => process.stderr.write(s + '\n');
const die = (s, code = 1) => {
  err(`wfdash: ${s}`);
  process.exit(code);
};

// ------------------------------------------------------------------ the target

/**
 * Parse a target into a route. Returns `/` for a bare invocation.
 *
 * **The current directory is never used to infer a map.** Measured against the corpus, a
 * cwd could unambiguously open 2 of 21 maps: ten live in a repo holding more than one map,
 * so a directory cannot name them even in principle.
 */
export function routeFor(target) {
  if (!target) return '/';
  const url = /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/.exec(target);
  if (url) return `/m/${url[1]}/${url[2]}/${url[3]}`;
  const hash = /^([^/\s]+)\/([^/#\s]+)#(\d+)$/.exec(target);
  if (hash) return `/m/${hash[1]}/${hash[2]}/${hash[3]}`;
  const slash = /^([^/\s]+)\/([^/\s]+)\/(\d+)$/.exec(target);
  if (slash) return `/m/${slash[1]}/${slash[2]}/${slash[3]}`;
  return null;
}

// ------------------------------------------------------------------ the probe

/**
 * `GET /api/health`, and the three outcomes ADR 0002 fixed.
 *
 * The probe *proves* liveness; a pidfile only ever guesses at it. `refused` is a real
 * answer here, not an error — it is how "nothing is running" is spelled.
 */
export async function probe(base = BASE, { timeoutMs = 2000 } = {}) {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.json().catch(() => null);
    if (body?.app === 'wfdash') return { kind: 'ours', health: body };
    return { kind: 'stranger', status: res.status, body };
  } catch (e) {
    const cause = e?.cause?.code ?? e?.code ?? e?.name;
    if (cause === 'ECONNREFUSED' || cause === 'ECONNRESET') return { kind: 'refused' };
    return { kind: 'stranger', error: String(e.message ?? e) };
  }
}

/** The same sentence the Server says when it cannot bind — one copy, shared. */
const strangerDeath = async () => die(takenMessage(PORT, await occupantOf(PORT)));

// ------------------------------------------------------------------ the browser

/**
 * Hand the URL to the OS and let it decide. A second `/wfdash` opens a second tab and
 * nothing steers or closes anything: tab-per-map is the feature, and every repair for the
 * duplicate case is refused by the browser anyway.
 */
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  return new Promise((resolve) => {
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: false, shell: process.platform === 'win32' });
    child.on('error', () => resolve(false));
    child.on('exit', () => resolve(true));
  });
}

// ------------------------------------------------------------------ spawn

async function spawnServer() {
  const child = spawn(process.execPath, [SERVER], {
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: process.env,
  });
  let stderrText = '';
  child.stderr.on('data', (d) => (stderrText += d));
  child.unref();

  // The pipe is only here to report a server that failed to start. Left open it would
  // hold this process's event loop after `unref()`, so the caller never exits and a
  // detached server becomes a hung terminal — the whole point is that the skill returns.
  const release = () => {
    child.stderr.destroy();
    child.stderr.unref?.();
  };

  const deadline = Date.now() + 10_000;
  for (;;) {
    const p = await probe(BASE, { timeoutMs: 500 });
    if (p.kind === 'ours') {
      release();
      return p.health;
    }
    if (p.kind === 'stranger') await strangerDeath();
    if (child.exitCode !== null || Date.now() > deadline) {
      die(`server did not come up on ${PORT}${stderrText ? `\n${stderrText.trim()}` : ''}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * The one case reuse gets wrong: you edited the server. A reused server runs the old code
 * and no amount of browser reloading fixes it.
 */
async function warnIfStale(health) {
  const disk = await stat(SERVER).catch(() => null);
  if (disk && health.serverMtime && disk.mtimeMs > health.serverMtime + 1) {
    err('wfdash: running server is stale — /wfdash restart');
  }
}

/** Auth dies in the terminal, before a browser opens: one line, fixable on the spot. */
async function requireGh() {
  await new Promise((resolve) => {
    execFile('gh', ['auth', 'status'], { timeout: 15000 }, (e, stdout, stderr) => {
      if (!e) return resolve();
      if (e.code === 'ENOENT') die('`gh` is not installed or not on PATH — see https://cli.github.com');
      die(`gh is not authenticated — run \`gh auth login\`\n${String(stderr || stdout || '').trim()}`);
    });
  });
}

// ------------------------------------------------------------------ the verbs

async function start(target) {
  const route = routeFor(target);
  if (route === null) die(`cannot read target ${JSON.stringify(target)} — try owner/repo#N`);
  await requireGh();

  const p = await probe();
  if (p.kind === 'stranger') await strangerDeath();

  const health = p.kind === 'ours' ? p.health : await spawnServer();
  if (p.kind === 'ours') await warnIfStale(health);

  const url = BASE + route;
  out(url);
  await openBrowser(url);
}

async function stop() {
  const p = await probe();
  if (p.kind === 'refused') return out('wfdash is not running');
  if (p.kind === 'stranger') return void (await strangerDeath());
  try {
    process.kill(p.health.pid, 'SIGTERM');
  } catch (e) {
    die(`could not kill pid ${p.health.pid}: ${e.message}`);
  }
  // Confirm rather than assume: the probe is the only proof of liveness this design has,
  // in both directions.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await probe(BASE, { timeoutMs: 400 })).kind === 'refused') return out(`stopped (pid ${p.health.pid})`);
    await new Promise((r) => setTimeout(r, 100));
  }
  die(`pid ${p.health.pid} did not exit`);
}

/** Exported so the installed skill can call it without re-implementing argv. */
export async function main(argv) {
  const verb = argv[0];
  if (verb === 'stop') return stop();
  if (verb === 'restart') {
    await stop();
    return start(argv[1]);
  }
  return start(verb);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main(process.argv.slice(2));
