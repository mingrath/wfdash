# Charting rules

Standing amendments to how a wayfinder map is charted. Every rule below states **when** it
applies, never where — so it holds wherever the steps it touches happen to sit today.

## Whenever you create a ticket, mark its attendance

Every ticket carries exactly one bare label, `hitl` or `afk`. Nothing is born unmarked.

**`hitl`** if resolving the ticket needs human eyes on a rendering, credentials only the
dev holds, or software only the dev can install. **Otherwise `afk`.**

You are already talking to the dev, so **state** the verdict in narration — "filing this as
`hitl`" — rather than stopping to ask. The dev corrects it if it is wrong.

Create the `hitl` and `afk` labels in the target repo if they are not there yet. Bare
names, no prefix.

## Whenever you wire a blocking arrow

Draw an arrow when B cannot start _usefully_ until A is finished — either because A's
answer would change B's question, or because A's output must physically exist for B to be
built. **Do not draw one because the two touch the same files.** Agents work in separate
worktrees, so a same-file pair collides only at merge, where git usually resolves it
unaided; an arrow trades that couple of minutes for a wait of the better part of an hour.

When a collision is foreseeable, **remove the collision — do not serialise the tickets.**
Assign the contested number at merge, not at the start.

## Whenever you create tickets — charting a map, or graduating fog after a resolution

Do three things.

1. **Send the agent first.** If a question can be answered by finding out, verifying,
   cataloguing or ruling out, chart it as research. Chart a grilling only for what the dev
   alone knows. Never charter an agent to choose, design or decide: research answers
   questions about the world, the dev answers questions about this project.

2. **Count the HITL tickets with no open blocker.**
   - Some, and the dev is still here → hand into one now rather than filing it for a later
     visit. One ticket per agent session still holds; start a fresh session inside the same
     sitting.
   - None, but HITL tickets exist → cut one arrow if you honestly can.
   - None, and none exist → say so. Name what the dev is waiting on and roughly how long.

3. **Before the dev walks away, count the AFK tickets with no open blocker.** If it is zero
   the sitting is not finished: chart the AFK work this sitting's answers have unlocked,
   now, while the reasoning is fresh. A dev who leaves with an empty runway gets no time
   back.

A **sitting** is one continuous stretch of the dev's presence, however many agent sessions
run inside it. A **runway** is the AFK tickets takeable at the moment the dev leaves.

## Whenever you close a ticket, count the HITL work left in the whole repo

Not this map's — the repo's, every map in it, blocked tickets included. One call answers
it: `gh issue list --repo <owner>/<name> --state open --label hitl`.

**More than zero → say nothing.** Work remains, handing into it is already a rule above,
and a second voice saying the same thing is noise.

**Zero → the sitting is over, and nothing else will say so.** Then, in this order:

1. Say it plainly: "Nothing left in `<repo>` needs you."

2. Count the `afk` tickets with **no open blocker**. The runway is the takeable ones, never
   every open one — the two routinely differ by a factor of five, and the larger number is
   a lie. Zero → say so, name the repo **finished** or **stalled** and on what, and stop
   there. **Do not chart work to manufacture a runway.** An empty runway at this moment is
   a failure of the count taken before the dev walks away, and it has to stay visible as
   one. Report here; repair belongs earlier.

3. Tell the dev to **start a fresh session** before running the batch. This one is full of
   the reasoning that produced the sitting's answers, and the waiting work needs none of it.

4. Compose the `/goal` line and show it ready to press. `/goal` takes a completion
   **condition**, not a task list, and the condition must require an **integration pass over
   the merged result** — every ticket green on its own is a weaker claim than it sounds.
   Say that `/goal` wants a trusted workspace and refuses where hooks are restricted, so the
   line is ready rather than guaranteed.

5. State that the batch runs **one sub-agent per ticket**. A single context worked across a
   dozen tickets rots long before the last one.

You compose the line. You never run it — pressing enter is the dev's.
