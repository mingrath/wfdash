#!/usr/bin/env node
// The installed skill's entry point, in both places the skill is installed from.
//
// Here, `~/.claude/skills/wfdash` is a symlink to this directory, so the skill updates with
// a `git pull` and there is nothing to copy or keep in step. This file exists because that
// symlink cannot be traversed with `..`: a path like `<skill>/../bin/wfdash.js` is
// normalised *lexically*, so it resolves against the skills directory rather than the
// checkout, and the entry point is not found.
//
// An ES module's own specifier is resolved against its real location instead, so importing
// a sibling directory from here lands in the checkout wherever it happens to live.
//
// In the published plugin this file sits two levels deeper, at
// `plugins/wayfinder-tools/skills/wfdash/`, so `bin/` is no longer a sibling. `publish.js`
// rewrites the specifier below for that depth and fails the release if it cannot — which
// is why the import is written plainly, on one line, rather than assembled.

import { main } from '../../bin/wfdash.js';

await main(process.argv.slice(2));
