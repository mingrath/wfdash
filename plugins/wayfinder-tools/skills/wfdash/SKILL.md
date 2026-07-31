---
name: wfdash
description: Serve wayfinder maps held in GitHub Issues as a local browser dashboard — one map drawn as a dependency DAG, plus an overview of every map across every repo. Use when the user asks what to work on next, wants to see a map's shape or frontier, wants to read a resolved ticket's decision, or types /wfdash. Also use for "what is takeable", "show me the map", "which effort should I pick".
---

# wfdash

A local, read-only browser dashboard over wayfinder maps. It shells out to `gh`, so it
inherits the dev's existing auth and **no token ever reaches the browser**, and it has
**zero write endpoints** — it never mutates the tracker.

## Running it

Run the launcher that sits beside this file — **not** a bare `bin/wfdash.js`, which only
resolves from the plugin root:

```sh
node "${CLAUDE_SKILL_DIR}/wfdash.mjs"                    # the overview
node "${CLAUDE_SKILL_DIR}/wfdash.mjs" owner/repo#12      # one map
node "${CLAUDE_SKILL_DIR}/wfdash.mjs" stop
node "${CLAUDE_SKILL_DIR}/wfdash.mjs" restart
```

It resolves the rest of the plugin from its own real location, so it works from any working
directory.

A target may be written `owner/repo#N`, `owner/repo/N`, or as a GitHub issue URL. A bare
invocation opens the overview — **the current directory is never used to infer a map**,
because measured against a 21-map corpus a cwd could unambiguously open only 2 of them.

The command prints the URL and opens a browser at it. Report that URL to the user.

## What the user sees

- **The overview** (`/`) — every wayfinder map they can see, across every repo, as a grid of
  cards sorted takeable-first. Each card says in a word whether there is anything to take:
  `N takeable`, `none takeable`, `✓ all N resolved`, or `no tickets yet`.
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
  port *is* the discovery mechanism: the launcher probes `GET /api/health` and reuses the
  server if it answers `{app: "wfdash"}`.
- **A second invocation opens a second tab**, and nothing steers or closes anything.
  Tab-per-map is the feature.
- **The server reaps itself after 30 idle minutes**, and an open tab heartbeats
  `/api/health` every 10 minutes to stop that happening under it. Those two numbers are
  coupled and move together.
- Zero npm dependencies and no build step, server and page alike.

## Updating it

This plugin is installed from a third-party marketplace, and those do not auto-update by
default. If the user wants the newest version:

```
/plugin marketplace update mingrath
```
