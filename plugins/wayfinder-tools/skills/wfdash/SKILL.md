---
name: wfdash
description: Serve wayfinder maps held in GitHub Issues as a local browser dashboard — one map drawn as a dependency DAG, plus an overview of every map across every repo. Use when the user asks what to work on next, wants to see a map's shape or frontier, wants to read a resolved ticket's decision, or types /wfdash. Also use for "what is takeable", "show me the map", "which effort should I pick".
---

# wfdash

A local, read-only browser dashboard over wayfinder maps. It shells out to `gh`, so it
inherits the user's existing auth and **no token ever reaches the browser**, and it has
**zero write endpoints** — it never mutates the tracker.

## Running it

```sh
wfdash                      # the overview
wfdash owner/repo#12        # one map
wfdash stop
wfdash restart
```

**If `wfdash` is not on `PATH`**, this copy came from the Claude Code plugin, which installs
no global command. Run the launcher sitting beside this file instead, with the same
arguments — Claude Code names that directory `${CLAUDE_SKILL_DIR}`:

```sh
node "${CLAUDE_SKILL_DIR}/wfdash.mjs" owner/repo#12
```

A target may be written `owner/repo#N`, `owner/repo/N`, or as a GitHub issue URL. A bare
invocation opens the overview — **the current directory is never used to infer a map**,
because measured against a 21-map corpus a cwd could unambiguously open only 2 of them.

The command prints the URL and opens a browser at it. Report that URL to the user.

**Where there is no browser** — a container, a cloud task, a background agent, a machine
with no display — it opens nothing and says so on a second line:

```
http://127.0.0.1:7777/m/owner/repo/12
wfdash: no browser here (no DISPLAY or WAYLAND_DISPLAY) — nothing was opened, the URL above is yours to open.
```

The dashboard is running either way; only the tab is missing. Pass that line on rather than
reporting a browser that did not open. `WFDASH_NO_BROWSER=1` forces this, which is the fix
for a Mac reached over SSH, where the opener "succeeds" by throwing a tab at whoever is
sitting at the console.

## What the user sees

- **The overview** (`/`) — every wayfinder map they can see, across every repo, as a grid of
  cards, newest-edited first inside `takeable → stalled → uncharted → finished`. A live card
  counts every open ticket by whether it needs the user: `7 hitl · 5 afk`, plus `· K unmarked`
  when anything is unclassified. A finished map says `✓ all N resolved` and an uncharted one
  `no tickets yet`. Whether anything can be *started* is the bar's green segment, not a word.
- **The map view** (`/m/<owner>/<repo>/<number>`) — one map as a layered dependency DAG,
  rank as a column, left to right, with a masthead carrying the destination and a dock
  carrying prose. Click a ticket for its question, its dependencies by name, and its whole
  comment thread.

Both pages poll, so claiming a ticket in the terminal shows up without a reload.

## Which maps the overview finds

It searches for open issues labelled `wayfinder:map` owned by **whoever `gh` is
authenticated as** — read once per process from `gh api user`, so it is right on the first
run without configuration.

`user:` was measured to **silently omit org and collaborator repos**. If the user's maps do
not all live under their own account, set `WFDASH_SEARCH` to an expression that reaches
them, for example `label:"wayfinder:map" state:open org:acme`. A search that quietly returns
a subset is the one failure this route cannot detect for itself, so an empty or short
overview is worth naming to the user rather than reporting as "no maps".

## What to tell the user when it fails

The command fails in the terminal for exactly two things, and both are one line to fix:

| what it prints | the fix |
| --- | --- |
| `gh is not authenticated` | `gh auth login` |
| `port 7777 is taken by <proc>` | rerun with `WFDASH_PORT=7778` |

Everything else — a mistyped repo, an issue that is not a map, a rate limit, a dependency
cycle — renders **in the page**, because the server is fine and only that target is not.

## Things worth knowing

- **Nothing about the running process is written to disk.** No pidfile, no port file. The
  port *is* the discovery mechanism: the command probes `GET /api/health` and reuses the
  server if it answers `{app: "wfdash"}`.
- **A second invocation opens a second tab**, and nothing steers or closes anything.
  Tab-per-map is the feature.
- **The server reaps itself after 30 idle minutes**, and an open tab heartbeats
  `/api/health` every 10 minutes to stop that happening under it. Those two numbers are
  coupled and move together.
- Zero npm dependencies and no build step, server and page alike. It needs `gh` on `PATH`
  and authenticated, and Node 18 or newer.

## Where this copy came from, and updating it

wfdash ships through two channels, and this file is the same in both.

| channel | install | update |
| --- | --- | --- |
| npm — any agent | `npm i -g @mingrath/wfdash`, then `wfdash install` | `npm i -g @mingrath/wfdash@latest`, then `wfdash install` |
| Claude Code plugin | `/plugin marketplace add mingrath/wfdash`, then `/plugin install wayfinder-tools@mingrath` | `/plugin marketplace update mingrath` |

`wfdash install` copies this skill into every agent on the machine that loads a `SKILL.md`
and reports what it wrote and what it skipped. It is the user's command to run, not one to
run on their behalf.

If the command prints a line saying this installed copy is older than the command itself,
the fix is to rerun `wfdash install`.
