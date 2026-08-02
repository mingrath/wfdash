---
name: wf-charting
description: The standing charting rules for wayfinder maps — mark every ticket hitl or afk as you create it, when a blocking arrow is warranted and why a shared file is not a reason for one, and how to chart a sitting so the dev is never left with nothing to answer or nothing running while they are away. Use whenever you are charting a wayfinder map, adding tickets to one, wiring blockers between them, or filing follow-up work once a question is resolved. Also use for "chart this effort", "add a ticket to the map", "should these two be wired", "what should I file before I stop".
---

# wf-charting

Standing amendments to how a wayfinder map is charted. They sit on top of however you
already chart — nothing here replaces a step, and every rule states **when** it applies
rather than where, so it holds whatever the charting procedure looks like today.

## Read the rules

**`charting.md`, beside this file, is the skill.** Read it and follow it. This file only
points at it, and deliberately does not restate a single rule: there is exactly one
authored copy of the rules, and the same bytes are also injected into `/wayfinder` sessions
by the `wayfinder-tools` plugin's hooks. Two copies would drift, so there is only one.

## When to read it

Whenever tickets are being made or wired — charting a fresh map, adding a ticket to an
existing one, drawing a blocker between two of them, or filing the follow-up work a
resolved question just unlocked. The rules fire at ticket creation, so reading them
afterwards is reading them too late.

## Why the marks matter

The `hitl` and `afk` labels are not bookkeeping. `wfdash` — the dashboard shipped from the
same repo as this skill, [`mingrath/wfdash`](https://github.com/mingrath/wfdash) — draws
them: the overview says per map whether an effort needs the dev present, and the map view
groups the frontier by them. A ticket created without one is invisible to both, and stays
that way, because unmarked is its own permanent value and never a synonym for `afk`.
