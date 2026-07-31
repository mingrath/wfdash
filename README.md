# wfdash

![the map view](docs/map-view.png)

A wayfinder map is a GitHub issue whose sub-issues are its tickets, wired together with
native issue dependencies. GitHub renders that as a flat list, so the shape of an effort —
what is finished, what is takeable right now, what is waiting on what — is not visible
anywhere. `wfdash` serves it as a local browser dashboard: one map drawn as a dependency
DAG, plus an overview of every map you can see, across every repo.

Read-only, zero npm dependencies, no build step.

## Requires

- Claude Code
- `gh` on `PATH` and authenticated — `gh auth login`
- Node 18 or newer (ES modules and a built-in `fetch`)
- Maps to look at. wfdash reads one convention: an issue labelled `wayfinder:map`, its
  tickets as GitHub sub-issues, blocking as native issue dependencies. It is built for
  maps charted by the `/wayfinder` skill.

## Install

    /plugin marketplace add mingrath/wfdash
    /plugin install wayfinder-tools@mingrath
    /reload-plugins

## Use

    /wayfinder-tools:wfdash                      # the overview
    /wayfinder-tools:wfdash owner/repo#12        # one map
    /wayfinder-tools:wfdash stop

A target may be written `owner/repo#N`, `owner/repo/N`, or as a GitHub issue URL.
The command prints a URL and opens a browser at it.

## What you get

- **The overview** — every map you can see, as cards sorted takeable-first. Each says in a
  word whether there is anything to take: `3 takeable`, `none takeable`, `✓ all 9 resolved`.
- **The map view** — one map as a layered DAG, rank as a column, left to right. Click a
  ticket for its question, its blockers by name, and its whole comment thread.

Both pages poll, so claiming a ticket in your terminal shows up without a reload.

## Finding your maps

The overview searches GitHub for open issues labelled `wayfinder:map` owned by whoever `gh`
is logged in as. Maps in an organisation's repos, or in repos you only collaborate on, are
not found by that search — set `WFDASH_SEARCH` to a query that reaches them:

    WFDASH_SEARCH='label:"wayfinder:map" state:open org:acme'

## What it will not do

- It never writes to your tracker. There are zero write endpoints.
- It shells out to `gh` from the server, so it inherits your existing auth and no token
  ever reaches the browser.
- It serves on `127.0.0.1:7777` and nowhere else. `WFDASH_PORT` moves it.
- It reaps itself after 30 idle minutes.

## Updating

Third-party marketplaces do not auto-update by default:

    /plugin marketplace update mingrath

## Contributing

Bug reports are welcome as issues. Pull requests are welcome too, but this repo is published
from another one as a squashed commit per release, so a PR cannot be merged directly — an
accepted patch is applied upstream and lands in the next release with you credited in the
commit.

## License

MIT.
