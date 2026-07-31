// Who has the port, and what to say about it.
//
// Both halves of the lifecycle need this and they must not disagree: the Server says it
// when it cannot bind, and the skill entry says it when the probe finds a stranger. Two
// copies of one sentence is one sentence that drifts.
//
// The port is never scanned and 7778 is never silently taken instead — a scanned port
// would have to be written down for the next invocation to find it, reintroducing exactly
// the state file this design exists to avoid. So the only repair offered is the override,
// and it is offered in words.

import { execFile } from 'node:child_process';

/** Name the occupant of a port. Best-effort: `lsof` failing is not itself a failure. */
export function occupantOf(port) {
  return new Promise((resolve) => {
    execFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { timeout: 4000 }, (err, stdout) => {
      const line = String(stdout ?? '').trim().split('\n')[1];
      if (err || !line) return resolve(null);
      const [command, pid] = line.split(/\s+/);
      resolve({ command, pid: Number(pid) });
    });
  });
}

/** One line, one rerun. Fixed-port collision is a confirmed real class on this machine. */
export const takenMessage = (port, occupant) =>
  `port ${port} is taken${occupant ? ` by ${occupant.command} (pid ${occupant.pid})` : ''}; rerun with WFDASH_PORT=${port + 1}`;
