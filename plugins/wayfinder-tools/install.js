// `wfdash install` — put the skill where every agent on this machine will find it.
//
// The research (`docs/research/agent-skill-loading.md`) turned "write 24 vendor paths" into
// a much smaller question: **`~/.agents/skills/` is read by 16 of the 24 confirmed products**,
// and the exception list is eight roots, not twenty-four. `.claude/skills/` is a
// compatibility alias, not the convention.
//
// Three rules the research fixed, which the code below is shaped by:
//
//   - **User level only.** Precedence runs in opposite directions — project beats user in
//     Kiro, OpenHands, Junie, Trae, Factory and Zed, but user beats project in Amp and
//     Cline, and Junie resolves the collision by skipping the user-level skill entirely.
//     An installer that writes both levels behaves differently on Amp than on everything
//     else, so it writes one.
//   - **Detect, never prompt.** An agent running this unattended would hang forever.
//   - **`SKILL.md` and nothing else.** The launcher `wfdash.mjs` exists for the Claude Code
//     plugin, where `bin/` is two levels up; copied anywhere else its import resolves to
//     nothing, and anywhere else `wfdash` is on PATH by construction.

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The shared root, and the reason this installer is eight rows rather than twenty-four. */
export const SHARED_ROOT = '.agents/skills';

/**
 * The agents that read the shared root, each with the directory that proves it is on this
 * machine. Their presence is what makes writing `~/.agents/skills/` worth doing; none of
 * them needs a path of its own.
 *
 * Devin is the sixteenth reader and is deliberately absent: it is repository-only, with no
 * user-level path at all, so a user-level installer cannot reach it.
 */
export const SHARED_READERS = [
  ['Codex CLI', '.codex'],
  ['Cursor', '.cursor'],
  ['Gemini CLI', '.gemini'],
  ['GitHub Copilot', '.copilot'],
  ['Amp', '.config/amp'],
  ['Goose', '.config/goose'],
  ['OpenHands', '.openhands'],
  ['opencode', '.config/opencode'],
  ['Charm Crush', '.config/crush'],
  ['Zed', '.config/zed'],
  ['Warp', '.warp'],
  ['Cline', '.cline'],
  ['Augment Code', '.augment'],
  ['OpenClaw', '.openclaw'],
  ['Factory Droid', '.factory'],
];

/**
 * The agents that read only a vendor-private path. **This is the list that rots** — not the
 * whole table — and it is eight rows, because paths in this ecosystem are added rather than
 * moved. A row here going stale means one agent misses an update, not that the installer
 * breaks.
 */
export const VENDOR_ONLY = [
  ['Claude Code', '.claude', '.claude/skills'],
  ['Continue.dev', '.continue', '.continue/skills'],
  ['Windsurf', '.codeium/windsurf', '.codeium/windsurf/skills'],
  ['Qwen Code', '.qwen', '.qwen/skills'],
  ['Kiro', '.kiro', '.kiro/skills'],
  ['JetBrains Junie', '.junie', '.junie/skills'],
  ['Trae', '.trae', '.trae/skills'],
  // Kilo Code answers to two spellings of its own config directory, so it gets a row each;
  // a machine with both gets both, which is what Kilo itself reads.
  ['Kilo Code', '.kilo', '.kilo/skills'],
  ['Kilo Code', '.kilocode', '.kilocode/skills'],
];

export const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Every root this installer ever writes to — and so every place a copy of it can be found. */
export const ROOTS = [SHARED_ROOT, ...VENDOR_ONLY.map(([, , root]) => root)];

/** Every agent this installer knows how to reach, in report order. */
export function agents() {
  return [
    { name: 'every agent reading the shared root', slug: 'shared', root: SHARED_ROOT, shared: true },
    ...VENDOR_ONLY.map(([name, probe, root]) => ({ name, slug: slugOf(name), probe, root, shared: false })),
  ];
}

// ------------------------------------------------------------------ the source

/**
 * Where the skill being installed comes from. In the published package it sits at
 * `skills/wfdash/`; in this checkout the published copy is the one under `publish/`, which
 * is deliberate — a development install writes exactly the bytes a release would, so the
 * test seam exercises the real file rather than a stand-in.
 */
const SOURCES = ['skills/wfdash', 'publish/plugins/wayfinder-tools/skills/wfdash'];
const MANIFESTS = ['package.json', 'publish/plugins/wayfinder-tools/package.json'];

const firstExisting = (candidates, file) => {
  for (const c of candidates) {
    const path = join(HERE, c, ...(file ? [file] : []));
    if (existsSync(path)) return path;
  }
  return null;
};

/** The version this copy of wfdash was cut at — the number the stamp carries. */
export async function version() {
  for (const rel of MANIFESTS) {
    const path = join(HERE, rel);
    if (!existsSync(path)) continue;
    const { version } = JSON.parse(await readFile(path, 'utf8'));
    if (version) return version;
  }
  return '0.0.0-dev';
}

/**
 * The stamp, and the whole of what makes an installed copy identifiable.
 *
 * It is an **HTML comment on the last line of the body**, not a frontmatter key. Frontmatter
 * is the one part of a `SKILL.md` that agents parse strictly and disagree about: the spec's
 * validator rejects unknown keys outright, and adding a `version:` would fail it. A comment
 * is inert in every parser, invisible in every renderer, and greppable in one line.
 */
export const STAMP = /^<!-- wfdash (\S+) — installed by `wfdash install`/m;
export const stampFor = (v) => `<!-- wfdash ${v} — installed by \`wfdash install\`; rerun it to update -->`;

/** The skill as it will be written: the shipped bytes plus one line naming the version. */
export async function payload(v) {
  const src = firstExisting(SOURCES, 'SKILL.md');
  if (!src) throw new Error('no skills/wfdash/SKILL.md beside this installer — nothing to install');
  return `${(await readFile(src, 'utf8')).trimEnd()}\n\n${stampFor(v)}\n`;
}

// ------------------------------------------------------------------ Claude Code

/**
 * Claude Code is skipped when the `wayfinder-tools` plugin is already installed: the plugin
 * carries this same skill, and a second copy in `~/.claude/skills/` would shadow or
 * duplicate it. A Claude user *without* the marketplace still gets the skill, which is the
 * case this rule exists to preserve.
 */
export async function claudePluginPresent(home) {
  const manifest = join(home, '.claude/plugins/installed_plugins.json');
  if (existsSync(manifest)) {
    try {
      const { plugins } = JSON.parse(await readFile(manifest, 'utf8'));
      if (Object.keys(plugins ?? {}).some((k) => k.split('@')[0] === 'wayfinder-tools')) return true;
    } catch {
      /* an unreadable manifest is not evidence of a plugin */
    }
  }
  // The cache is the other half of the same fact, and survives a manifest this code cannot
  // parse — the format has already changed once (`"version": 2`).
  const cache = join(home, '.claude/plugins/cache');
  if (!existsSync(cache)) return false;
  for (const market of await readdir(cache).catch(() => [])) {
    if (existsSync(join(cache, market, 'wayfinder-tools'))) return true;
  }
  return false;
}

// ------------------------------------------------------------------ the plan

/**
 * What to do with each target, decided before anything is written.
 *
 * The shared root is written when **an agent that reads it is present**, or when the root
 * already exists because someone made it deliberately. It is never created speculatively:
 * on a machine with no such agent it is a directory nothing asked for.
 */
export async function plan({ home = homedir(), only = null } = {}) {
  const has = (rel) => existsSync(join(home, rel));
  const found = SHARED_READERS.filter(([, probe]) => has(probe)).map(([name]) => name);
  const pluginPresent = await claudePluginPresent(home);

  return agents().map((agent) => {
    const forced = only === agent.slug;
    if (agent.shared) {
      const reason = has(SHARED_ROOT)
        ? `${SHARED_ROOT} already exists`
        : found.length
          ? `${found.join(', ')} ${found.length === 1 ? 'reads' : 'read'} it`
          : null;
      return {
        ...agent,
        detail: found.length ? found.join(', ') : 'no agent here reads it',
        write: forced || reason !== null,
        skip: reason === null && !forced ? 'no agent on this machine reads the shared root' : null,
      };
    }
    if (agent.name === 'Claude Code' && pluginPresent && !forced) {
      return { ...agent, detail: agent.name, write: false, skip: 'the wayfinder-tools plugin is already installed' };
    }
    return {
      ...agent,
      detail: agent.name,
      write: forced || has(agent.probe),
      skip: null,
      absent: !has(agent.probe),
    };
  });
}

// ------------------------------------------------------------------ writing

const rel = (home, path) => (path.startsWith(home) ? `~${path.slice(home.length)}` : path);

async function writeOne(home, target, body, { force }) {
  const dir = join(home, target.root, 'wfdash');
  const file = join(dir, 'SKILL.md');
  const where = rel(home, file);

  let existing = null;
  if (existsSync(file)) existing = await readFile(file, 'utf8').catch(() => null);

  // Someone else's skill called `wfdash` — or this repo's own development symlink. Refusing
  // is the only safe answer: overwriting is the one failure here that destroys work, and
  // the stamp is what tells the two apart.
  if (existing !== null && !STAMP.test(existing) && !force) {
    return { verb: 'skipped', where, why: 'a SKILL.md is there that wfdash did not write; `--force` replaces it' };
  }
  if (existing === body) return { verb: 'unchanged', where };

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, body);
  } catch (e) {
    return { verb: 'failed', where, why: e.code ?? e.message };
  }
  return { verb: existing === null ? 'wrote' : 'updated', where };
}

// ------------------------------------------------------------------ staleness

/**
 * Every installed copy whose stamp is not `v`.
 *
 * **The command does not know where it was installed to** — nothing is written down, here
 * as everywhere else in wfdash. So it does not remember: it re-derives the same nine roots
 * it would write to and reads the stamp out of any `SKILL.md` sitting in one. The table is
 * the single source of truth for both directions, which is the only way the two can't drift.
 *
 * Copies with no stamp are silently ignored, and that is load-bearing: the Claude Code
 * plugin's own `skills/wfdash/SKILL.md` is unstamped because the installer never wrote it,
 * so a plugin user is never told their skill is stale by the command the plugin ships.
 */
export async function staleInstalls({ home = homedir(), v } = {}) {
  const found = [];
  for (const root of ROOTS) {
    const file = join(home, root, 'wfdash', 'SKILL.md');
    if (!existsSync(file)) continue;
    const stamp = STAMP.exec(await readFile(file, 'utf8').catch(() => ''));
    if (stamp && stamp[1] !== v) found.push({ where: rel(home, file), version: stamp[1] });
  }
  return found;
}

/** `a` is an earlier release than `b`. Unparseable either side answers `false` — "differs". */
export function olderThan(a, b) {
  const parts = (s) => /^(\d+)\.(\d+)\.(\d+)/.exec(s)?.slice(1, 4).map(Number);
  const [x, y] = [parts(a), parts(b)];
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
}

// ------------------------------------------------------------------ the report

/** The shared row can name fifteen agents; four and a count is as much as a line can hold. */
const summarise = (names, keep = 3) =>
  names.length <= keep + 1 ? names.join(', ') : `${names.slice(0, keep).join(', ')} and ${names.length - keep} more`;

/**
 * One format, plain text, verb first.
 *
 * There is no `--json`. The readers are agents and humans, and an agent reads a verb and a
 * path as well as it reads a key and a value; a second output format would be a second
 * thing to keep in step for no reader that exists.
 */
export async function install({ home = homedir(), only = null, force = false, all = false, out = console.log } = {}) {
  const v = await version();
  const body = await payload(v);
  const targets = await plan({ home, only });

  if (only && !targets.some((t) => t.slug === only)) {
    const names = [...new Set(targets.map((t) => t.slug))].join(', ');
    out(`wfdash: no agent called ${only} — try one of: ${names}`);
    return 1;
  }

  const rows = [];
  const absent = [];
  for (const target of only ? targets.filter((t) => t.slug === only) : targets) {
    const detail = target.shared ? summarise(target.detail.split(', ')) : target.detail;
    if (target.skip) {
      rows.push({ verb: 'skipped', where: `~/${target.root}/`, why: target.skip, detail: target.shared ? '' : detail });
      continue;
    }
    if (!target.write) {
      if (!absent.includes(target.name)) absent.push(target.name);
      if (all) rows.push({ verb: 'absent', where: `~/${target.probe}`, why: 'not on this machine', detail });
      continue;
    }
    rows.push({ ...(await writeOne(home, target, body, { force })), detail });
  }

  const landed = rows.filter((r) => ['wrote', 'updated', 'unchanged'].includes(r.verb));
  out(`wfdash ${v} — ${landed.length ? `installed into ${landed.length} of ${rows.length} target${rows.length === 1 ? '' : 's'}` : 'installed nowhere'}`);
  out('');
  const wid = Math.min(48, Math.max(0, ...rows.map((r) => r.where.length)));
  for (const r of rows) {
    const said = r.why ? (r.detail ? `${r.detail} — ${r.why}` : r.why) : r.detail;
    out(`  ${r.verb.padEnd(9)} ${r.where.padEnd(wid)}  ${said}`.trimEnd());
  }
  if (absent.length && !all) {
    out('');
    out(`  not on this machine: ${absent.join(', ')}`);
    out('  `--all` lists them; `--agent <name>` installs into one anyway');
  }

  // A fan-out: one unwritable vendor directory must not fail the other fifteen. An install
  // that landed *nowhere* is a different thing, and is a failure.
  return landed.length ? 0 : 1;
}
