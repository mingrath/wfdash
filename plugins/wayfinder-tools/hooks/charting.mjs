#!/usr/bin/env node
// The overlay's delivery: print `charting.md` back as hook output, so the charting rules
// arrive as context on a `/wayfinder` session without anything having edited that skill.
//
// Two hooks run this one script — `UserPromptExpansion` when a human types the command,
// `PreToolUse` when an agent invokes the skill — and an `additionalContext` payload is only
// honoured when its `hookEventName` names the event that produced it. So the event is not
// assumed: it is read from the hook's own stdin payload, with the name `hooks.json` passes
// on the command line as the fallback. Told neither, the script says nothing at all rather
// than guess wrong and have its output silently dropped.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

async function stdin() {
  if (process.stdin.isTTY) return '';
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

let fromPayload;
try {
  fromPayload = JSON.parse(await stdin())?.hook_event_name;
} catch {
  /* not JSON, or nothing on stdin — the argv fallback answers for it */
}

const hookEventName = fromPayload || process.argv[2];
if (!hookEventName) process.exit(0);

const additionalContext = await readFile(join(HERE, 'charting.md'), 'utf8');
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } }) + '\n');
